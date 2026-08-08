# AGENTS.md

Multi-tenant School ERP (FastAPI + asyncpg + PostgreSQL backend; Preact + Vite + TypeScript frontend). Single codebase, one shared Postgres, logical isolation by `tenant_id`.

## Start every session here

1. Read `CLAUDE.md` — non-negotiable architecture rules (multi-tenancy, events, deploy, approval gates, live-data rules).
2. Read `BUILD.md` — current state; the top entry is the last completed change. This is where finished work is recorded.
3. Read `ARCHITECTURE.md` — schemas, API catalog, event catalog, ADRs, migration index.

"Definition of done" requires updating `BUILD.md` and `ARCHITECTURE.md` after any feature (and documenting any new event).

## Live-data rule (critical)

Two tenants carry REAL data and must never be touched by one-off/reset/seed/destructive operations without explicit owner authorization: `daffodilspublicschool` (DPS) and `premchandmahtoic` (PMIC). `premchandhighschool` and `vivekmemorialhighschool` are unconfirmed (look like seed data). Check the tenant slug before running any script — many one-off scripts under `backend/scripts/` and `scripts/` target a specific tenant.

## Local dev

- Dev DB: `docker compose up -d postgres` (postgres:16 on `localhost:5432`, creds `tulips`/`tulips`, db `tulipsedu`).
- Backend: from `backend/`, `DATABASE_URL=postgresql://tulips:tulips@localhost:5432/tulipsedu .venv/bin/uvicorn main:app --reload`. Dev venv exists at `backend/.venv`.
- Frontend: `npm run dev` in `frontend/` (port 5173, proxies `/api` → `localhost:8000`).
- All API calls need tenant context — send `X-Tenant-Slug: <slug>` header in dev (no real subdomain locally).
- Backend lint: `ruff check` from `backend/` (line-length 100, `select = ["E","F","I"]`; ruff is a dev extra, may need `uv sync --extra dev`). No frontend lint or formatter configured.
- Frontend typecheck: `npm run typecheck` (`tsc --noEmit`); `npm run build` = `tsc && vite build`.

## Tests

- No unit-test isolation: pytest suite is integration tests against a **running** backend (`BASE_URL`, default `http://localhost:8000`) + DB (`DATABASE_URL`). Start the stack first.
- `pytest -m "not live"` from `backend/` — write-path suite. `conftest.py` provisions an ephemeral tenant (unique slug, CASCADE-deleted at session end) so it never touches real data.
- `pytest -m live` is a **SELECT-only audit of the real tenants** (reads `audit_live_tenants.py` checks). Never run it against a dev DB; it only makes sense where live tenants exist.
- No frontend tests.

## Migrations

- Append-only versioned SQL files: `migrations/NNN_name.sql`. **Never edit an applied migration** — add a new file.
- Every migration must be reversible and wrapped in a transaction (they run via `scripts/apply_migrations.py` on container start; `schema_migrations` tracks what's applied).
- Schema changes trigger the approval gate in `CLAUDE.md`.

## Deploy

- The ONLY deploy path is `scripts/deploy.sh` (gate → migration-check+backup → rsync → health-check with auto-rollback → smoke tests). Never rsync + docker manually.
- Commit + push before deploying (deploy rsyncs the working tree; prod must be recoverable from git).
- Branch model: `dev` = active development, `prod` = what's deployed (fast-forward only). See `CLAUDE.md`.
- To check prod: `ssh swap@62.72.13.103` (repo at `~/tulips`). Backend health only via `docker exec tulips-backend-1` — port 8000 isn't exposed to the host.
- Back up the prod DB (`scripts/backup_db.sh`) before any destructive operation.

## Repo quirks

- No CI (no `.github/`). The `scripts/predeploy_gate.sh` docker stack is the test gate.
- A local launchd job (`scripts/auto_save.sh`) commits + pushes the working tree to `main` every ~30 min — don't be surprised by `auto-save:` commits.
- Backend uses raw SQL via asyncpg (no ORM); services in `backend/services/`, routes in `backend/api/v1/`, models in `backend/models/` (mostly thin), event emission in `backend/core/events.py`.
- Every state-changing op must emit an event (inserted into immutable `audit_events`, consumed by the single-instance worker in `backend/worker/`).
- Feature toggles live in `tenants.feature_flags` JSONB (decoded to a dict by `backend/middleware/tenant.py`); absent flag reads as OFF.
- Frontend is Preact (import from `preact`, not React), PWA via `vite-plugin-pwa` with `injectManifest` strategy (`frontend/public/sw.js`).
