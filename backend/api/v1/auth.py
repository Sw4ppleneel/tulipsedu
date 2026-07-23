from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from jose import JWTError

from core.security import create_access_token, create_refresh_token, decode_token
from models.auth import ChangePasswordRequest, LoginRequest, RefreshRequest, TokenResponse
from services.auth import AuthError, change_own_password, login

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
async def auth_login(req: LoginRequest, request: Request):
    tenant_id = getattr(request.state, "tenant_id", None)
    if tenant_id is None:
        raise HTTPException(status_code=400, detail="Missing tenant context")

    tenant_slug = getattr(request.state, "tenant_slug", "")
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        try:
            return await login(conn, tenant_id, tenant_slug, req)
        except AuthError as e:
            raise HTTPException(status_code=401, detail=str(e))


@router.post("/refresh", response_model=TokenResponse)
async def auth_refresh(req: RefreshRequest, request: Request):
    tenant_id = getattr(request.state, "tenant_id", None)
    if tenant_id is None:
        raise HTTPException(status_code=400, detail="Missing tenant context")

    try:
        claims = decode_token(req.refresh_token)
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    if claims.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid token type")

    if str(tenant_id) != str(claims.get("tenant_id")):
        raise HTTPException(status_code=403, detail="Tenant mismatch")

    # Re-query current roles rather than trusting the refresh token's own
    # (possibly stale) claims — a role change made after the original login
    # takes effect on the next refresh instead of only on next full login.
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        roles_rows = await conn.fetch(
            """
            SELECT role FROM user_roles WHERE tenant_id = $1 AND user_id = $2
            ORDER BY CASE role
                WHEN 'superadmin' THEN 0
                WHEN 'principal' THEN 1
                WHEN 'vice_principal' THEN 2
                WHEN 'class_teacher' THEN 3
                WHEN 'teacher' THEN 4
                WHEN 'accountant' THEN 5
                ELSE 6
            END
            """,
            tenant_id, UUID(claims["sub"]),
        )
    roles = [r["role"] for r in roles_rows]
    if not roles:
        raise HTTPException(status_code=401, detail="Account has no assigned role")

    token_data = {
        "sub": claims["sub"],
        "tenant_id": claims["tenant_id"],
        "tenant_slug": claims.get("tenant_slug", ""),
        "roles": roles,
    }

    return TokenResponse(
        access_token=create_access_token(token_data),
        refresh_token=create_refresh_token(token_data),
    )


@router.post("/logout")
async def auth_logout():
    # JWT is stateless — client discards tokens on logout.
    # Future: persist refresh token blocklist for forced invalidation.
    return {"detail": "Logged out"}


@router.put("/password")
async def auth_change_password(req: ChangePasswordRequest, request: Request):
    tenant_id = getattr(request.state, "tenant_id", None)
    user_id = getattr(request.state, "user_id", None)
    if tenant_id is None or user_id is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    pool = request.app.state.pool
    async with pool.acquire() as conn:
        try:
            await change_own_password(
                conn, tenant_id, UUID(user_id), req.current_password, req.new_password
            )
        except AuthError as e:
            raise HTTPException(status_code=401, detail=str(e))
    return {"detail": "Password changed"}
