from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
from jose import jwt

from config import settings


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(data: dict[str, Any]) -> str:
    payload = {
        **data,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes),
        "iat": datetime.now(timezone.utc),
        "type": "access",
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def create_refresh_token(data: dict[str, Any]) -> str:
    payload = {
        **data,
        "exp": datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days),
        "iat": datetime.now(timezone.utc),
        "type": "refresh",
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def create_upload_token(admission_id: Any, tenant_id: Any, minutes: int = 30) -> str:
    """Short-lived token authorising document uploads for ONE admission enquiry.

    Not an access token (type != "access"), so the tenant middleware rejects it
    on protected routes — the admission upload endpoints are JWT-exempt and verify
    this token themselves.
    """
    payload = {
        "type": "admission_upload",
        "admission_id": str(admission_id),
        "tenant_id": str(tenant_id),
        "exp": datetime.now(timezone.utc) + timedelta(minutes=minutes),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def decode_token(token: str) -> dict[str, Any]:
    return jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
