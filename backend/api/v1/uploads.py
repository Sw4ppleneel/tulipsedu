"""
Presigned R2 upload URL endpoint.

Requires env vars: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
R2_BUCKET_NAME, R2_PUBLIC_URL. Returns 501 if not configured.

Install boto3 when ready: pip install boto3
"""
import uuid as uuid_lib

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from config import settings
from core.rbac import require_roles

try:
    import boto3
    import botocore.exceptions
    from botocore.config import Config as BotocoreConfig
    _HAS_BOTO3 = True
except ImportError:
    _HAS_BOTO3 = False

router = APIRouter(prefix="/uploads", tags=["Uploads"])

ALLOWED_CONTENT_TYPES = {
    # Images
    "image/jpeg", "image/png", "image/webp", "image/gif",
    # Documents
    "application/pdf",
    # Office
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # mirrors frontend limit; enforced server-side in /confirm

UPLOAD_ROLES = ("principal", "vice_principal", "class_teacher", "teacher")


class UploadRequest(BaseModel):
    filename: str
    content_type: str = "application/octet-stream"


class UploadResponse(BaseModel):
    upload_url: str
    object_key: str
    public_url: str
    content_type: str


class ConfirmRequest(BaseModel):
    object_key: str


class ConfirmResponse(BaseModel):
    size: int


_r2_client_singleton = None


def _r2_client():
    global _r2_client_singleton
    if _r2_client_singleton is None:
        _r2_client_singleton = boto3.client(
            "s3",
            endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
            config=BotocoreConfig(signature_version="s3v4"),
            region_name="auto",
        )
    return _r2_client_singleton


@router.post(
    "/url",
    response_model=UploadResponse,
    dependencies=[Depends(require_roles(*UPLOAD_ROLES))],
)
async def get_upload_url(body: UploadRequest, request: Request):
    if not _HAS_BOTO3 or not settings.r2_bucket_name:
        raise HTTPException(status_code=501, detail="File uploads not configured")

    if body.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"File type '{body.content_type}' is not allowed. Upload images, PDF, or Office documents only.",
        )

    tenant_id = request.state.tenant_id
    ext = body.filename.rsplit(".", 1)[-1] if "." in body.filename else "bin"
    key = f"{tenant_id}/{uuid_lib.uuid4()}.{ext}"

    client = _r2_client()
    # Presigned PUT — R2 does not implement presigned POST (S3 POST policy), so the
    # content-length-range condition that would enforce max size server-side at upload
    # time isn't available here. /confirm below closes that gap after the fact via a
    # HEAD request, without proxying the file body through the app server.
    upload_url = client.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": settings.r2_bucket_name,
            "Key": key,
            "ContentType": body.content_type,
        },
        ExpiresIn=300,
    )
    public_url = f"{settings.r2_public_url.rstrip('/')}/{key}"
    return UploadResponse(
        upload_url=upload_url,
        object_key=key,
        public_url=public_url,
        content_type=body.content_type,
    )


@router.post(
    "/confirm",
    response_model=ConfirmResponse,
    dependencies=[Depends(require_roles(*UPLOAD_ROLES))],
)
async def confirm_upload(body: ConfirmRequest, request: Request):
    """Called after the browser PUTs the file straight to R2. Verifies the object
    landed within the size limit (a client could otherwise lie about file.size before
    upload) and deletes it if not — closing the gap left by R2 not supporting
    presigned POST's content-length-range condition.
    """
    if not _HAS_BOTO3 or not settings.r2_bucket_name:
        raise HTTPException(status_code=501, detail="File uploads not configured")

    tenant_id = request.state.tenant_id
    if not body.object_key.startswith(f"{tenant_id}/"):
        raise HTTPException(status_code=403, detail="Object key does not belong to this tenant")

    client = _r2_client()
    try:
        head = client.head_object(Bucket=settings.r2_bucket_name, Key=body.object_key)
    except botocore.exceptions.ClientError:
        raise HTTPException(status_code=404, detail="Uploaded object not found")

    size = head["ContentLength"]
    if size == 0 or size > MAX_UPLOAD_BYTES:
        client.delete_object(Bucket=settings.r2_bucket_name, Key=body.object_key)
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit",
        )
    return ConfirmResponse(size=size)
