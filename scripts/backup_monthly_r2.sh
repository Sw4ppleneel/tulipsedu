#!/usr/bin/env bash
#
# Monthly encrypted off-site backup of the Tulips.edu prod DB to Cloudflare R2.
#
# Flow: fresh pg_dump -> gzip -> AES-256 encrypt (passphrase from a root-only
# file on this host) -> upload the CIPHERTEXT to the db-backups/ folder of the
# R2 bucket, using the backend container's existing R2 credentials.
#
# The uploaded object is encrypted, so it is safe to store in R2 even though the
# bucket's CDN domain may serve objects publicly. R2 just accumulates these
# monthly files; collect them to a local drive and clear R2 whenever you like.
#
# Installed via cron (01:00 on the 1st of each month, server/UTC time):
#   0 1 1 * * /home/swap/tulips/scripts/backup_monthly_r2.sh >> /home/swap/tulips/backups/backup.log 2>&1
#
# Set the passphrase ONCE, on the VPS, in your own terminal (never in chat):
#   umask 077 && printf %s 'YOUR-STRONG-PASSPHRASE' > ~/tulips/.r2_backup_pass
#
# Download + decrypt a monthly file later:
#   # (download db-backups/tulipsedu-monthly-YYYY-MM.sql.gz.enc from R2 first)
#   openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
#     -in tulipsedu-monthly-YYYY-MM.sql.gz.enc -out tulipsedu-YYYY-MM.sql.gz \
#     -pass pass:'YOUR-STRONG-PASSPHRASE'
#   gunzip -c tulipsedu-YYYY-MM.sql.gz | docker exec -i tulips-postgres-1 psql -U tulips -d tulipsedu
#
set -euo pipefail
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

PG_CONTAINER="${PG_CONTAINER:-tulips-postgres-1}"
APP_CONTAINER="${APP_CONTAINER:-tulips-backend-1}"
DB_USER="${DB_USER:-tulips}"
DB_NAME="${DB_NAME:-tulipsedu}"
PASS_FILE="${PASS_FILE:-$HOME/tulips/.r2_backup_pass}"
R2_PREFIX="${R2_PREFIX:-db-backups}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"; docker exec "$APP_CONTAINER" rm -f /tmp/_r2up.enc 2>/dev/null || true' EXIT

if [ ! -s "$PASS_FILE" ]; then
  echo "$(date -Is) MONTHLY R2 ERROR: passphrase file $PASS_FILE is missing/empty — refusing to upload an unencrypted or keyless backup" >&2
  exit 1
fi

# Label the period that just ended (script runs on the 1st -> previous month).
label="$(date -d 'yesterday' +%Y-%m 2>/dev/null || date +%Y-%m)"
gz="$WORK/${DB_NAME}-monthly-${label}.sql.gz"
enc="${gz}.enc"
key="${R2_PREFIX}/${DB_NAME}-monthly-${label}.sql.gz.enc"

# 1. Fresh full dump (pipefail => a pg_dump failure aborts the whole pipeline).
docker exec "$PG_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" | gzip -c > "$gz"

# 2. Encrypt with AES-256 + PBKDF2 key derivation.
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$gz" -out "$enc" -pass file:"$PASS_FILE"

# 3. Upload the ciphertext via the backend container's R2 credentials.
docker cp "$enc" "$APP_CONTAINER":/tmp/_r2up.enc
docker exec "$APP_CONTAINER" python -c '
import sys, boto3
from config import settings
c = boto3.client("s3",
    endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
    aws_access_key_id=settings.r2_access_key_id,
    aws_secret_access_key=settings.r2_secret_access_key,
    region_name="auto")
c.upload_file("/tmp/_r2up.enc", settings.r2_bucket_name, sys.argv[1])
print("uploaded:", sys.argv[1])
' "$key"

echo "$(date -Is) monthly R2 backup ok: $key ($(du -h "$enc" | cut -f1))"
