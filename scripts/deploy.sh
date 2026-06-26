#!/usr/bin/env bash
# scripts/deploy.sh — Tulips.edu safe deploy
#
# Failure points covered:
#   1. Test regression  → pre-deploy gate (L1 suite) blocks the entire deploy
#   2. Migration crash  → DB backup taken before migrations land; health-check
#                         catches a failed migration (entrypoint exits non-zero
#                         → container exits → health poll times out → rollback)
#   3. Backend crash    → health check (20 × 3 s = 60 s) → auto-rollback to
#                         `tulips-backend:rollback` image
#   4. Frontend build   → built inside docker before nginx is restarted; old
#                         dist stays live if the build container fails
#   5. Post-deploy      → smoke tests verify key endpoints still respond
#
# Usage:
#   scripts/deploy.sh                   # full deploy (gate + backend + frontend)
#   scripts/deploy.sh --frontend-only   # skip gate + backend build
#   scripts/deploy.sh --backend-only    # build backend only, skip frontend
#   scripts/deploy.sh --skip-gate       # dangerous: skip L1 suite
#
# Exit codes: 0 = success, 1 = failure (reason printed to stderr)

set -euo pipefail
cd "$(dirname "$0")/.."

REMOTE="swap@62.72.13.103"
DIR="~/tulips"
COMPOSE="docker compose -f docker-compose.prod.yml"
SKIP_GATE=0; FRONTEND_ONLY=0; BACKEND_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --skip-gate)      SKIP_GATE=1 ;;
    --frontend-only)  FRONTEND_ONLY=1 ;;
    --backend-only)   BACKEND_ONLY=1 ;;
  esac
done

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
die()  { echo -e "${RED}✗ DEPLOY ABORTED:${NC} $*" >&2; exit 1; }
step() { echo -e "\n${BOLD}==> [$1/5] $2${NC}"; }

# ── 1. Pre-deploy gate ────────────────────────────────────────────────────────
step 1 "Pre-deploy gate (L1 test suite)"
if [ "$SKIP_GATE" -eq 1 ] || [ "$FRONTEND_ONLY" -eq 1 ]; then
  warn "Gate skipped"
else
  scripts/predeploy_gate.sh || die "Gate FAILED — fix failing tests before deploying"
  ok "Gate passed"
fi

# ── 2. Migration check + DB backup ───────────────────────────────────────────
step 2 "Migration check"
if [ "$FRONTEND_ONLY" -eq 0 ]; then
  LOCAL=$(ls migrations/*.sql | xargs -I{} basename {} | sort)
  APPLIED=$(ssh "$REMOTE" \
    "docker exec tulips-postgres-1 psql -U tulips -d tulipsedu -t -c \
     'SELECT version FROM schema_migrations ORDER BY version'" 2>/dev/null \
    | grep -v '^$' | sed 's/[[:space:]]//g' | sort)
  PENDING=$(comm -23 <(echo "$LOCAL") <(echo "$APPLIED"))

  if [ -n "$PENDING" ]; then
    echo "  Pending:"
    echo "$PENDING" | sed 's/^/    /'
    echo "  Taking DB backup before migration..."
    ssh "$REMOTE" "bash $DIR/scripts/backup_db.sh" \
      || die "DB backup failed — not deploying with a pending migration"
    ok "DB backed up; migration will apply on container start"
  else
    ok "No pending migrations"
  fi
else
  warn "Migration check skipped (--frontend-only)"
fi

# ── 3. Rsync ──────────────────────────────────────────────────────────────────
step 3 "Syncing files to prod"
rsync -az \
  --exclude='backend/.env' \
  --exclude='backend/.venv' \
  --exclude='__pycache__' \
  --exclude='*.pyc' \
  --exclude='frontend/node_modules' \
  --exclude='frontend/dist' \
  ./ "$REMOTE:$DIR/"
ok "Sync complete"

# ── 4. Build + deploy ─────────────────────────────────────────────────────────
step 4 "Building and deploying"

if [ "$FRONTEND_ONLY" -eq 0 ]; then
  # Tag current image as rollback target before replacing it
  ssh "$REMOTE" "cd $DIR && \
    docker tag tulips-backend:latest tulips-backend:rollback 2>/dev/null || true && \
    $COMPOSE build backend worker && \
    $COMPOSE up -d backend worker"

  echo "  Waiting for backend health..."
  HEALTHY=0
  for i in $(seq 1 20); do
    STATUS=$(ssh "$REMOTE" \
      "docker exec tulips-backend-1 python3 -c \
       \"import urllib.request; print(urllib.request.urlopen('http://localhost:8000/health').read().decode())\" \
       2>/dev/null" 2>/dev/null || echo "")
    if echo "$STATUS" | grep -q '"ok"'; then
      ok "Backend healthy (attempt $i/20)"
      HEALTHY=1
      break
    fi
    echo "  Attempt $i/20 — waiting 3 s..."
    sleep 3
  done

  if [ "$HEALTHY" -eq 0 ]; then
    warn "Backend never became healthy — rolling back to previous image"
    ssh "$REMOTE" "cd $DIR && \
      docker tag tulips-backend:rollback tulips-backend:latest 2>/dev/null || true && \
      $COMPOSE up -d --no-build backend worker" || true
    die "Backend deploy FAILED. Rolled back to previous image. Check logs: ssh $REMOTE 'docker logs tulips-backend-1 --tail 80'"
  fi
fi

if [ "$BACKEND_ONLY" -eq 0 ]; then
  ssh "$REMOTE" "cd $DIR && \
    $COMPOSE run --rm frontend_build && \
    $COMPOSE restart nginx"
  ok "Frontend built, nginx restarted"
fi

ok "Deploy complete"

# ── 5. Smoke tests ────────────────────────────────────────────────────────────
step 5 "Smoke tests"
scripts/smoke_test.sh \
  || { warn "Smoke tests failed — investigate before declaring success"; exit 1; }

echo ""
ok "All done. Prod is live."
