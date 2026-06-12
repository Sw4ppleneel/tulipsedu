#!/bin/sh
set -e

echo "[entrypoint] Running pending migrations..."
python scripts/apply_migrations.py

echo "[entrypoint] Starting gunicorn..."
exec gunicorn main:app \
  --workers "${WORKERS:-4}" \
  --worker-class uvicorn.workers.UvicornWorker \
  --bind "0.0.0.0:${PORT:-8000}" \
  --timeout "${TIMEOUT:-30}" \
  --graceful-timeout 10 \
  --access-logfile - \
  --error-logfile - \
  --log-level "${LOG_LEVEL:-info}"
