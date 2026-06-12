"""Role-based access control.

Two layers:
  1. require_roles(*roles)  — coarse gate. Is this role allowed on the route?
  2. load_class_scope        — fine gate. Resolves a teaching user's assigned
                               (class_id, section_id) set into request.state so
                               handlers can reject out-of-scope writes.

The JWT already carries `role` (signed in services/auth.py) and the tenant
middleware sets request.state.user_role. Guards read from there. superadmin
is implicitly permitted on every gate. Parents auth via a separate path and
never reach these staff routes.
"""

import uuid

from fastapi import HTTPException, Request

# Roles that operate school-wide with no class restriction.
UNRESTRICTED_ROLES = frozenset({"superadmin", "principal", "vice_principal"})


def require_roles(*allowed: str):
    """Return a dependency that 403s unless the caller's role is permitted.

    superadmin is always allowed. Usage:
        APIRouter(..., dependencies=[Depends(require_roles("principal"))])
        @router.post(..., dependencies=[Depends(require_roles("accountant"))])
    """
    allowed_set = frozenset(allowed) | {"superadmin"}

    def guard(request: Request) -> None:
        role = getattr(request.state, "user_role", None)
        if role not in allowed_set:
            raise HTTPException(
                status_code=403, detail="Insufficient role for this operation"
            )

    return guard


async def load_class_scope(request: Request) -> None:
    """Populate request.state.class_scope and request.state.staff_id.

    class_scope is:
      - None            for unrestricted roles (admin tier) — no filtering.
      - set of (class_id, section_id) tuples for teaching roles.
        An empty set means the user has no assignments and may touch nothing.
    """
    role = getattr(request.state, "user_role", None)
    request.state.staff_id = None

    if role in UNRESTRICTED_ROLES:
        request.state.class_scope = None
        return

    pool = request.app.state.pool
    tenant_id = request.state.tenant_id
    user_id = uuid.UUID(request.state.user_id)

    async with pool.acquire() as conn:
        staff = await conn.fetchrow(
            "SELECT id FROM staff WHERE tenant_id = $1 AND user_id = $2 AND is_active = TRUE",
            tenant_id,
            user_id,
        )
        if not staff:
            request.state.class_scope = set()
            return

        request.state.staff_id = staff["id"]
        rows = await conn.fetch(
            """
            SELECT class_id, section_id
            FROM staff_class_assignments
            WHERE tenant_id = $1 AND staff_id = $2
            """,
            tenant_id,
            staff["id"],
        )

    request.state.class_scope = {(r["class_id"], r["section_id"]) for r in rows}


def assert_in_scope(request: Request, class_id: uuid.UUID, section_id: uuid.UUID) -> None:
    """Raise 403 if the caller may not act on this class/section.

    No-op for unrestricted roles (class_scope is None). Call load_class_scope
    as a route dependency before using this.
    """
    scope = getattr(request.state, "class_scope", None)
    if scope is None:
        return
    if (class_id, section_id) not in scope:
        raise HTTPException(
            status_code=403, detail="Outside your assigned class scope"
        )
