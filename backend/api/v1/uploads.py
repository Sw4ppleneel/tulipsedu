"""
Presigned R2 upload URL endpoint.

Requires env vars: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
R2_BUCKET_NAME, R2_PUBLIC_URL. Returns 501 if not configured.

Install boto3 when ready: pip install boto3
"""
import uuid as uuid_lib

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from config import settings

try:
    import boto3
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


class UploadRequest(BaseModel):
    filename: str
    content_type: str = "application/octet-stream"


class UploadResponse(BaseModel):
    upload_url: str
    object_key: str
    public_url: str


def _r2_client():
    return boto3.client(
        "s3",
        endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        config=BotocoreConfig(signature_version="s3v4"),
        region_name="auto",
    )


@router.post("/url", response_model=UploadResponse)
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
    return UploadResponse(upload_url=upload_url, object_key=key, public_url=public_url)
