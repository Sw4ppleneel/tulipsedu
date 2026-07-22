"""Role-based access control.

Two layers:
  1. require_roles(*roles)  — coarse gate. Is any of this caller's roles
                               allowed on the route?
  2. load_class_scope        — fine gate. Resolves a teaching user's assigned
                               (class_id, section_id) set into request.state so
                               handlers can reject out-of-scope writes.

A staff member can hold more than one role at once (e.g. accountant +
teacher). The JWT carries `roles` (a list, signed in services/auth.py) and
the tenant middleware sets request.state.user_roles (a frozenset). Guards
check set membership/intersection against the caller's full role set —
never just whichever role happens to be "active" in the frontend UI, since
that's a display-only concept the backend never sees. superadmin is
implicitly permitted on every gate. Parents auth via a separate path and
never reach these staff routes.
"""

import uuid

from fastapi import HTTPException, Request

# True admin tier — fully unrestricted class scope, no matter what else they
# hold. Deliberately does NOT include accountant: accountant needs tenant-
# wide reach for its own purpose (the fee-collection roster lookup, handled
# explicitly in api/v1/students.py) but must not blanket-unrestrict a combo
# user's TEACHING-scoped actions just because they also hold accountant — a
# real bug this used to cause: an accountant+teacher with zero actual class
# assignments got tenant-wide attendance/homework access, the same breadth as
# a principal, instead of being scoped to whatever classes they're actually
# assigned to like any other teacher.
ADMIN_TIER_ROLES = frozenset({"superadmin", "principal", "vice_principal"})


def require_roles(*allowed: str):
    """Return a dependency that 403s unless one of the caller's held roles
    is permitted.

    superadmin is always allowed. Usage:
        APIRouter(..., dependencies=[Depends(require_roles("principal"))])
        @router.post(..., dependencies=[Depends(require_roles("accountant"))])
    """
    allowed_set = frozenset(allowed) | {"superadmin"}

    def guard(request: Request) -> None:
        roles = getattr(request.state, "user_roles", frozenset())
        if not (roles & allowed_set):
            raise HTTPException(
                status_code=403, detail="Insufficient role for this operation"
            )

    return guard


async def load_class_scope(request: Request) -> None:
    """Populate request.state.class_scope and request.state.staff_id.

    class_scope is:
      - None            if the caller holds any true admin-tier role
                        (superadmin/principal/vice_principal) — no
                        filtering, even if they also hold a scoped role
                        like teacher.
      - set of (class_id, section_id) tuples otherwise — resolved from
        actual staff_class_assignments rows, regardless of whether the
        caller also holds accountant. An empty set means the user has no
        assignments and may touch nothing via this scope.
    """
    roles = getattr(request.state, "user_roles", frozenset())
    request.state.staff_id = None

    if roles & ADMIN_TIER_ROLES:
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
