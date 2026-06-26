import uuid

import asyncpg

from core.events import emit
from core.security import create_access_token, create_refresh_token, verify_password
from models.auth import LoginRequest, TokenResponse


class AuthError(Exception):
    pass


async def login(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, tenant_slug: str, req: LoginRequest
) -> TokenResponse:
    row = await conn.fetchrow(
        """
        SELECT u.id, u.password_hash, u.role, u.is_active, s.first_name
        FROM users u
        LEFT JOIN staff s ON s.user_id = u.id AND s.tenant_id = u.tenant_id
        WHERE u.tenant_id = $1 AND u.phone_number = $2
        """,
        tenant_id,
        req.phone_number,
    )

    if not row or not verify_password(req.password, row["password_hash"]):
        raise AuthError("Invalid credentials")

    if not row["is_active"]:
        raise AuthError("Account is inactive")

    token_data = {
        "sub": str(row["id"]),
        "tenant_id": str(tenant_id),
        "tenant_slug": tenant_slug,
        "role": row["role"],
        "first_name": row["first_name"] or "",
    }

    await emit(conn, "STAFF_AUTHENTICATED", tenant_id, {"user_id": str(row["id"])})

    return TokenResponse(
        access_token=create_access_token(token_data),
        refresh_token=create_refresh_token(token_data),
    )
