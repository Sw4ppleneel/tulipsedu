# BUILD.md

# Project Status

Project: Tulips.edu

Phase:
Phase 1 MVP

Current Sprint:
Project Foundation & Multi-Tenant Core

Status:
In Progress

Last Updated:
2026-06-03

---

# Current Objectives

## Sprint Goal

Build the foundational platform architecture required for all future ERP modules.

Deliverables:

* Multi-tenant infrastructure
* Authentication system
* Tenant isolation middleware
* Database migration framework
* Event audit framework
* Base frontend shell
* Docker deployment stack

---

# Current TODO

## High Priority

* [x] Initialize repository structure
* [x] Configure Docker environment
* [x] Configure PostgreSQL
* [x] Configure migration framework
* [x] Create tenant schema
* [x] Create user authentication schema
* [x] Create event logging framework
* [x] Create tenant isolation middleware
* [x] Auth endpoints (login / refresh / logout)
* [ ] RBAC framework (role-based route guards)

## Medium Priority

* [x] Setup frontend shell (Preact + Vite)
* [x] Setup IndexedDB abstraction
* [x] Setup API client layer
* [x] Setup service worker framework
* [ ] Connect frontend login form to live backend

## Low Priority

* [ ] CI/CD pipeline
* [ ] Monitoring setup
* [ ] Backup automation

---

# In Progress

None

---

# Completed

## 2026-06-03 — Sprint Foundation

### Work Completed

Full project scaffold built from zero:

- Repository structure, Docker, migration framework
- PostgreSQL schemas: `tenants`, `users`, `audit_events`
- Backend: FastAPI app, asyncpg pool, pydantic-settings config
- Tenant isolation middleware: subdomain extraction + JWT tenant claim validation; `X-Tenant-Slug` header for local dev
- Auth endpoints: POST /api/v1/auth/login, /refresh, /logout
- Event audit: `emit()` helper, STAFF_AUTHENTICATED fires on successful login
- Frontend: Preact + Vite + TypeScript shell, login form, API client, IndexedDB queue abstraction, service worker stub

### Files Added

```
docker-compose.yml
nginx.conf
migrations/001_tenants.sql
migrations/002_users.sql
migrations/003_audit_events.sql
scripts/apply_migrations.py
scripts/seed_tenant.py
backend/requirements.txt
backend/pyproject.toml
backend/Dockerfile
backend/.env.example
backend/main.py
backend/config.py
backend/db/pool.py
backend/core/security.py
backend/core/events.py
backend/middleware/tenant.py
backend/models/auth.py
backend/services/auth.py
backend/api/v1/router.py
backend/api/v1/auth.py
frontend/package.json
frontend/tsconfig.json
frontend/vite.config.ts
frontend/index.html
frontend/public/sw.js
frontend/public/manifest.json
frontend/src/main.tsx
frontend/src/app.tsx
frontend/src/api/client.ts
frontend/src/types/auth.ts
frontend/src/db/idb.ts
tests/__init__.py
```

### Decisions Made

- `X-Tenant-Slug` request header supported as local dev override for subdomain-based tenant resolution
- logout endpoint is JWT-exempt (stateless, client discards token)
- scripts require backend venv; asyncpg used directly (no ORM in scripts)

### APIs Added

- POST /api/v1/auth/login
- POST /api/v1/auth/refresh
- POST /api/v1/auth/logout

### Events Added

- STAFF_AUTHENTICATED (emitted on successful login)

---

# Architectural Decisions

## ADR-001

Decision:
Single multi-tenant monolith.

Reason:
Operational simplicity and cost efficiency.

Status:
Approved

---

## ADR-002

Decision:
Offline-first attendance architecture.

Reason:
Target environments have unstable network conditions.

Status:
Approved

---

## ADR-003

Decision:
Cloudflare R2 for file storage.

Reason:
Avoid application-server media handling.

Status:
Approved

---

## ADR-004

Decision:
X-Tenant-Slug header allowed as tenant override for local dev and testing.

Reason:
localhost has no subdomain; subdomain-based routing only works in production.

Status:
Approved

---

# Known Issues

None

---

# Blockers

None

---

# Next Recommended Task

Sprint Foundation verification:

1. `cd backend && pip install -r requirements.txt`
2. `docker compose up postgres -d`
3. `DATABASE_URL=... python scripts/apply_migrations.py`
4. `DATABASE_URL=... python scripts/seed_tenant.py`
5. `uvicorn main:app --reload --port 8000`
6. POST `http://localhost:8000/api/v1/auth/login` with `X-Tenant-Slug: demo`

Then: Student Management vertical slice.
