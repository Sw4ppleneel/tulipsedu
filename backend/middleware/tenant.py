import logging

from fastapi import Request
from jose import JWTError
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from config import settings
from core.security import decode_token

logger = logging.getLogger(__name__)

# Paths that require tenant context but no JWT
_JWT_EXEMPT = frozenset({
    "/api/v1/auth/login",
    "/api/v1/auth/refresh",
    "/api/v1/auth/logout",
    "/api/v1/parent/auth/request-otp",
    "/api/v1/parent/auth/verify-otp",
    "/api/v1/parent/auth/login",
})

# Path prefixes that are JWT-exempt (public CMS endpoints)
_JWT_EXEMPT_PREFIXES = ("/api/v1/public/",)

# Paths that bypass tenant lookup entirely
_TENANT_EXEMPT = frozenset({"/health"})


class TenantMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # Webhooks carry tenant slug in path; HMAC-verified inside the handler
        if path.startswith("/api/v1/payments/webhooks/"):
            return await call_next(request)

        if path in _TENANT_EXEMPT or path.startswith("/docs") or path.startswith("/openapi"):
            return await call_next(request)

        slug = self._extract_slug(request)
        if not slug:
            return JSONResponse(
                status_code=400,
                content={"detail": "Missing tenant context — use subdomain or X-Tenant-Slug header"},
            )

        pool = request.app.state.pool
        async with pool.acquire() as conn:
            tenant = await conn.fetchrow(
                "SELECT id, slug, feature_flags FROM tenants WHERE slug = $1", slug
            )

        if not tenant:
            return JSONResponse(status_code=404, content={"detail": "Tenant not found"})

        request.state.tenant_id = tenant["id"]
        request.state.tenant_slug = tenant["slug"]
        request.state.feature_flags = tenant["feature_flags"] or {}

        jwt_exempt = path in _JWT_EXEMPT or any(path.startswith(p) for p in _JWT_EXEMPT_PREFIXES)
        if not jwt_exempt:
            auth_header = request.headers.get("authorization", "")
            if not auth_header.startswith("Bearer "):
                return JSONResponse(status_code=401, content={"detail": "Missing authorization"})

            try:
                claims = decode_token(auth_header[7:])
            except JWTError:
                return JSONResponse(status_code=401, content={"detail": "Invalid or expired token"})

            if claims.get("type") != "access":
                return JSONResponse(status_code=401, content={"detail": "Invalid token type"})

            if str(tenant["id"]) != str(claims.get("tenant_id")):
                logger.warning(
                    "Tenant mismatch: subdomain=%s jwt_tenant=%s ip=%s",
                    slug,
                    claims.get("tenant_id"),
                    request.client.host if request.client else "unknown",
                )
                return JSONResponse(status_code=403, content={"detail": "Tenant mismatch"})

            request.state.user_id = claims["sub"]
            request.state.user_role = claims["role"]

        return await call_next(request)

    def _extract_slug(self, request: Request) -> str | None:
        # X-Tenant-Slug header takes precedence — used in local dev and testing
        slug = request.headers.get("x-tenant-slug")
        if slug:
            return slug.strip().lower()

        host = request.headers.get("host", "").split(":")[0]
        if host in ("localhost", "127.0.0.1"):
            return None

        parts = host.split(".")
        base_parts = settings.base_domain.count(".") + 1
        if len(parts) > base_parts:
            return parts[0]

        return None
