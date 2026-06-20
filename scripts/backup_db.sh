#!/usr/bin/env bash
#
# Daily Postgres backup for Tulips.edu (prod).
# Dumps the tulipsedu database from the postgres container, gzips it, and
# rotates out dumps older than RETENTION_DAYS so the VPS disk never fills.
#
# Installed via cron (00:30 server time):
#   30 0 * * * /home/swap/tulips/scripts/backup_db.sh >> /home/swap/tulips/backups/backup.log 2>&1
#
# Restore a dump:
#   gunzip -c tulipsedu-YYYY-MM-DD-HHMM.sql.gz | \
#     docker exec -i tulips-postgres-1 psql -U tulips -d tulipsedu
#
set -euo pipefail

# cron runs with a minimal PATH; make docker reachable.
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

BACKUP_DIR="${BACKUP_DIR:-$HOME/tulips/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
PG_CONTAINER="${PG_CONTAINER:-tulips-postgres-1}"
DB_USER="${DB_USER:-tulips}"
DB_NAME="${DB_NAME:-tulipsedu}"

mkdir -p "$BACKUP_DIR"

ts="$(date +%F-%H%M)"
out="$BACKUP_DIR/${DB_NAME}-${ts}.sql.gz"
tmp="${out}.tmp"

# pipefail ensures a pg_dump failure fails the whole pipeline (no truncated dump kept).
if docker exec "$PG_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" | gzip -c > "$tmp"; then
  mv "$tmp" "$out"
  echo "$(date -Is) backup ok: $out ($(du -h "$out" | cut -f1))"
else
  rm -f "$tmp"
  echo "$(date -Is) backup FAILED for $DB_NAME" >&2
  exit 1
fi

# Rotate: delete dumps older than the retention window.
deleted="$(find "$BACKUP_DIR" -maxdepth 1 -name "${DB_NAME}-*.sql.gz" -type f -mtime "+${RETENTION_DAYS}" -print -delete | wc -l | tr -d ' ')"
echo "$(date -Is) rotation: removed ${deleted} dump(s) older than ${RETENTION_DAYS} days"
