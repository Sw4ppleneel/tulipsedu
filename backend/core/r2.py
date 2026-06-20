"""Shared Cloudflare R2 (S3-compatible) client.

Both the authenticated staff upload endpoint and the public admission-document
upload flow use this. Returns a lazily-built, cached boto3 S3 client pointed at
the R2 endpoint. `r2_enabled()` reports whether uploads can be served at all.
"""
from config import settings

try:
    import boto3
    from botocore.config import Config as BotocoreConfig
    from botocore.exceptions import ClientError as R2ClientError
    _HAS_BOTO3 = True
except ImportError:  # pragma: no cover - boto3 always present in prod image
    _HAS_BOTO3 = False
    R2ClientError = Exception  # type: ignore

_client = None


def r2_enabled() -> bool:
    return _HAS_BOTO3 and bool(settings.r2_bucket_name)


def r2_client():
    global _client
    if _client is None:
        _client = boto3.client(
            "s3",
            endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
            config=BotocoreConfig(signature_version="s3v4"),
            region_name="auto",
        )
    return _client
