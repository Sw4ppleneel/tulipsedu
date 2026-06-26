#!/usr/bin/env bash
# scripts/smoke_test.sh — Post-deploy smoke tests
#
# Verifies that key backend and frontend endpoints still respond correctly
# after a deploy. Run standalone or called automatically by scripts/deploy.sh.
#
# Backend checks go through docker exec (port 8000 is not exposed to the host).
# Nginx checks go through HTTPS on the host (-k skips cert for localhost).
#
# Exit code: 0 = all passed, 1 = one or more failed.

set -euo pipefail
REMOTE="swap@62.72.13.103"
FAIL=0

GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
pass() { echo -e "  ${GREEN}✓${NC} $1"; }
fail_check() { echo -e "  ${RED}✗${NC} $1" >&2; FAIL=1; }

# Backend check — via docker exec (port 8000 is internal to docker network)
# Pass TENANT header so middleware doesn't short-circuit with 400 before auth runs.
check_api() {
  local label="$1" path="$2" expected="${3:-200}"
  local got
  got=$(ssh "$REMOTE" \
    "docker exec tulips-backend-1 python3 -c \
\"import urllib.request
req = urllib.request.Request(
    'http://localhost:8000${path}',
    headers={'X-Tenant-Slug': 'daffodilspublicschool'}
)
try:
    r = urllib.request.urlopen(req)
    print(r.status)
except urllib.error.HTTPError as e:
    print(e.code)
except Exception as e:
    print(0)
\"" 2>/dev/null | tr -d '[:space:]' || echo "000")
  if [ "$got" = "$expected" ]; then
    pass "$label [$got]"
  else
    fail_check "$label — expected $expected, got $got"
  fi
}

# Nginx check — via HTTPS on host (-k skips cert for localhost)
check_nginx() {
  local label="$1" path="$2" expected="${3:-200}"
  local got
  got=$(ssh "$REMOTE" \
    "curl -s -o /dev/null -w '%{http_code}' -k 'https://localhost${path}'" \
    2>/dev/null || echo "000")
  if [ "$got" = "$expected" ]; then
    pass "$label [$got]"
  else
    fail_check "$label — expected $expected, got $got"
  fi
}

echo "--- Backend (via docker exec) ---"
check_api  "Health"                      "/health"
check_api  "Students → 401 unauthed"     "/api/v1/students"         "401"
check_api  "Staff → 401 unauthed"        "/api/v1/staff"            "401"
check_api  "Fees → 401 unauthed"         "/api/v1/fees/heads"       "401"

echo "--- Nginx / SPA (HTTPS) ---"
check_nginx "SPA root"                   "/"
check_nginx "Login route"               "/login"

echo "--- Public school sites ---"
check_nginx "Daffodils"                 "/daffodilspublicschool"
check_nginx "Premchand IC"              "/premchandmahtoic"
check_nginx "Premchand HS"              "/premchandhighschool"
check_nginx "Vivek Memorial"            "/vivekmemorialhighschool"

if [ "$FAIL" -ne 0 ]; then
  echo ""
  echo "SMOKE TESTS FAILED — investigate before declaring deploy successful" >&2
  exit 1
fi
echo ""
echo "All smoke tests passed."
