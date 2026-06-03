# BUILD.md

# Project Status

Project: Tulips.edu

Phase:
Phase 1 MVP

Current Sprint:
Production Readiness

Status:
MVP Feature Complete — Awaiting Domain + VPS + R2 Credentials for Deployment

Last Updated:
2026-06-03

---

# Current Objectives

## Sprint Goal

Deploy to production when domain / VPS / R2 credentials are provided.

---

# Current TODO

## High Priority (Deployment Blockers)

* [ ] Receive domain name from user → update `BASE_DOMAIN`, `APP_BASE_URL` in `backend/.env`
* [ ] Receive VPS credentials → provision with `docker-compose.prod.yml`
* [ ] Receive Cloudflare R2 credentials → add to `backend/.env` (R2_ACCOUNT_ID, etc.)
* [ ] Run certbot for wildcard SSL: `certbot certonly --dns-cloudflare -d *.tulipsedu.in`
* [ ] Seed production tenant: `python scripts/seed_platform.py` → `python scripts/seed_tenant.py`

## Medium Priority (Post-Launch)

* [ ] SMS provider integration (Twilio / MSG91) for parent OTP delivery
* [ ] Push notifications for parents (homework/fee reminders)
* [ ] Razorpay webhook verification hardening
* [ ] Admin-driven parent ↔ student manual linking UI

## Low Priority

* [ ] CI/CD pipeline (GitHub Actions → Docker build → VPS deploy)
* [ ] Monitoring (Prometheus + Grafana or Sentry)
* [ ] Automated DB backups (pg_dump → R2)

---

# In Progress

None

---

# Completed

## 2026-06-03 — Parent Portal + CMS + Production Infrastructure

### Work Completed

Parent Portal vertical slice:
- Migration 016: parents + parent_students tables (auto-link by parent_phone)
- OTP authentication: 6-digit OTP, bcrypt-hashed, 10-minute TTL, dev mode returns OTP in response
- API: POST /parent/auth/request-otp, POST /parent/auth/verify-otp
- API: GET /parent/students, GET /parent/students/:id/summary
- Summary response: attendance %, fee balance (from fee_ledger), recent homework feed
- Frontend: ParentPortalView (mobile-first, 480px max-width, attendance ring, fee balance, homework list)
- Frontend: OTP login flow (phone → OTP → portal), "Parent Login" button on main login page
- Parent JWT role='parent' correctly isolated from staff app shell

CMS vertical slice:
- Migration 017: cms_pages (slug-keyed, sort_order) + cms_announcements (published_at, expires_at)
- Admin API: full CRUD for pages + announcements (auth required)
- Public API: GET /public/school-info, GET /public/pages, GET /public/pages/:slug, GET /public/announcements (JWT-free, active-only filter for announcements)
- Frontend: CmsAdminView with Pages tab (HTML editor, slug, published toggle) and Announcements tab

Production infrastructure:
- backend/.env.example — all env vars documented
- backend/Dockerfile.prod — gunicorn + uvicorn workers, runs migrations at startup
- scripts/entrypoint.sh — migrations → gunicorn with configurable workers/timeout
- docker-compose.prod.yml — postgres + backend + nginx + frontend_build profile, separate networks
- nginx.prod.conf — SSL, HTTP→HTTPS redirect, auth rate limiting (10r/m burst 5), API rate limiting (120r/m), security headers (HSTS, X-Frame-Options, nosniff), gzip, certbot ACME support

Backend improvements:
- config.py: CORS_ORIGIN_REGEX support for wildcard subdomain matching in production
- main.py: dynamic CORS config (regex or explicit origins)
- middleware/tenant.py: parent auth + /public/ paths exempted from JWT validation
- api/v1/uploads.py: R2 presigned URL endpoint (returns 501 until R2 credentials set)
- All 85+ routes registered and verified

### APIs Added
- POST /api/v1/parent/auth/request-otp
- POST /api/v1/parent/auth/verify-otp
- GET /api/v1/parent/students
- GET /api/v1/parent/students/:id/summary
- POST/GET /api/v1/cms/pages
- PUT/DELETE /api/v1/cms/pages/:id
- POST/GET /api/v1/cms/announcements
- PUT/DELETE /api/v1/cms/announcements/:id
- GET /api/v1/public/school-info
- GET /api/v1/public/pages
- GET /api/v1/public/pages/:slug
- GET /api/v1/public/announcements
- POST /api/v1/uploads/url

### Events Added
- PARENT_LOGIN

### Bugs Fixed
- services/parent.py: attendance query used `submitted_at` (does not exist), fixed to `submitted = TRUE`
- services/parent.py: class sort column was `display_order` (does not exist), fixed to `numeric_order`
- services/parent.py: fee query rewrote to use actual schema (fee_ledger, fee_payments) instead of assumed student_fees/payments tables

---

## 2026-06-03 — Homework, Timetable, Examination Frontend

### Work Completed

Full frontend for three modules already completed in previous session:
- HomeworkView: post list, create form, type/class filters, soft-delete (204 fix)
- TimetableView: week grid per class-section, add/delete slots
- ExamView: marks entry per term/subject, result sheet with CBSE grades

### Bugs Fixed
- client.ts: 204 No Content responses caused JSON parse error — added early return
- vite.config.ts: zimmerframe CJS/ESM conflict patched, HMR overlay disabled
- services/exam.py: f-string SyntaxError in consolidated results query
- services/timetable.py: asyncpg TIME column requires datetime.time objects

---

## 2026-06-03 — Homework, Timetable, Examination Backend

Full backend: migrations 012–015, models, services, API routes (20 endpoints)

---

## 2026-06-03 — Finance Module

Full Finance vertical slice: fee structures, payments, receipts, superadmin panel

---

## 2026-06-03 — Staff Management + ClassSwipe Attendance

Full Staff Management and ClassSwipe Attendance vertical slices

---

## 2026-06-03 — Student Management

Full Student Management vertical slice with VirtualList frontend

---

## 2026-06-03 — Sprint Foundation

Project scaffold, Docker, migration framework, auth, tenant isolation, Preact frontend shell

---

# Architectural Decisions

## ADR-001 — Single multi-tenant monolith
Reason: Operational simplicity and cost efficiency. Status: Approved

## ADR-002 — Offline-first attendance
Reason: Target environments have unstable network conditions. Status: Approved

## ADR-003 — Cloudflare R2 for file storage
Reason: Avoid application-server media handling. Status: Approved

## ADR-004 — X-Tenant-Slug header for local dev
Reason: localhost has no subdomain. Status: Approved

## ADR-005 — OTP parent auth (no password)
Reason: Parents are non-technical users; password recovery via phone is simpler and more secure. Status: Approved

## ADR-006 — Parent-student auto-link by phone
Reason: Reduces admin overhead; students already have parent_phone field in the database. Manual override available. Status: Approved

---

# Known Issues

None

---

# Blockers

Waiting for:
- Domain name (for nginx.prod.conf server_name and BASE_DOMAIN env var)
- VPS SSH credentials (for provisioning)
- Cloudflare R2 bucket + credentials (for file uploads)
- SMS provider credentials (for production OTP delivery; dev mode works without it)

---

# Deployment Runbook (once credentials arrive)

1. SSH into VPS
2. Clone repo: `git clone ... && cd Tulips.edu`
3. Copy env: `cp backend/.env.example backend/.env` → fill in all values
4. Set POSTGRES_PASSWORD in shell: `export POSTGRES_PASSWORD=strong_password`
5. Build frontend: `docker compose -f docker-compose.prod.yml --profile build run --rm frontend_build`
6. Start stack: `docker compose -f docker-compose.prod.yml up -d`
7. SSL: install certbot, run `certbot certonly --dns-cloudflare -d "*.tulipsedu.in"`
8. Seed first institution: `docker compose exec backend python scripts/seed_platform.py`
9. Verify: `curl https://demo.tulipsedu.in/health`
