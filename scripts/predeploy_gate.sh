#!/usr/bin/env bash
# Pre-deploy gate. Stands up a disposable backend+Postgres from the CURRENT
# source, runs the L1 write-path suite (pytest -m "not live") against it, and
# exits non-zero if anything is red — so the deploy can be aborted on failure.
#
# The L3 live-data audit is NOT run here (it reads real tenants); it runs on a
# cron via backend/scripts/audit_live_tenants.py.
#
# Usage:
#   scripts/predeploy_gate.sh && <deploy...>   # only deploy if the gate passes
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT="tulips-gate"
COMPOSE="docker compose -f docker-compose.gate.yml -p ${PROJECT}"

cleanup() { $COMPOSE down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo ">> pre-deploy gate: building disposable stack + running L1 suite"
$COMPOSE up -d --build gate-db gate-backend

# gate-tests runs the suite and exits with pytest's status; --exit-code-from
# propagates it so a red suite fails this script (and thus the deploy).
set +e
$COMPOSE up --build --abort-on-container-exit --exit-code-from gate-tests gate-tests
code=$?
set -e

if [ "$code" -ne 0 ]; then
  echo ">> GATE FAILED (pytest exit ${code}) — NOT safe to deploy" >&2
  exit "$code"
fi
echo ">> GATE PASSED — safe to deploy"
