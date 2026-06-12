# ARCHITECTURE.md

# Current Reality (2026-06-12)

Deployed to production on the VPS (Cloudflare-proxied, `*.tulipsedu.in`, 4 schools seeded):

- Multi-tenant schema + JWT auth + tenant-isolation middleware
- RBAC: 6 staff roles + parent (migration 018), role gates at middleware and service layer
- Student / Staff management
- ClassSwipe Attendance (offline-first, edit-after-submit)
- Finance: fee heads, schedules, per-student ledger, payments, receipts, Excel import, UPI QR
- Homework & Feed, Timetable (with teacher assignment), Examination (terms, subjects,
  mark components → grade rollup)
- Parent Portal (admission-number login, attendance/fee/homework summary, UPI QR pay)
- CMS (pages + announcements) + per-tenant public website at the subdomain root
- **Apex marketing site** — static `index.html` served at `tulipsedu.in` / `www` (2026-06-12)

## Honest assessment: this is a CRUD amalgamation, not yet a workflow ERP

Every module is a competent set of forms over its own tables, but the modules do not
drive processes across each other. The connective tissue is missing:

- **Events are write-only.** `core/events.py::emit()` only INSERTs into `audit_events`.
  Producers fire (ATTENDANCE_MARKED, FEE_COLLECTED, EXAM_PUBLISHED, …) but **nothing
  consumes them** — there is no event bus and no worker. The "event-driven architecture"
  in CLAUDE.md has producers and no subscribers.
- **No background worker** ("Background Jobs: TBD"). The 202/async mandate for SMS, email,
  and PDF is therefore unfulfilled — those features simply don't exist (no absent alerts,
  no fee reminders, no report-card PDFs).
- **No lifecycle/state machines.** Records are flat. There is no admission pipeline, no
  exam-term lifecycle (draft→open→locked→published), no fee escalation (due→overdue).
- **No cross-module orchestration.** Creating a student doesn't assign fees or provision
  parent access; there is no academic-year rollover (the flagship multi-step transaction
  named in CLAUDE.md); approving an admission doesn't exist.
- **No notifications table.** Parents must pull (log in and check); nothing is pushed.

The transformation plan that closes this gap is the north-star section at the top of
ROADMAP.md; the ordered work is the "Workflow ERP Transformation" TODO in BUILD.md, and
the architectural decision is captured in ADR-010 below.

---

# System Overview

Tulips.edu is a multi-tenant School ERP SaaS platform designed for rural and semi-urban institutions.

Primary Constraints:

* Single codebase
* Multi-tenant architecture (shared DB, logical isolation by tenant_id)
* Offline-first attendance
* Sub-2MB frontend bundle target
* Low-cost deployment (~₹2,000/month)
* Low-end Android compatibility

---

# Technology Stack

## Backend

Framework: FastAPI
Language: Python 3.11+
Database: PostgreSQL 16
Driver: asyncpg
Authentication: JWT (python-jose, HS256)
Password Hashing: bcrypt (passlib)
Config: pydantic-settings
Background Jobs: NOT YET BUILT — see ADR-010 (event-bus worker). Until it exists, every
SMS/email/PDF feature is blocked and domain events are audit-only (see Event Catalog note).

## Frontend

Framework: Preact
Build Tool: Vite
Language: TypeScript
Offline Storage: IndexedDB
Caching: Service Worker

## Infrastructure

Reverse Proxy: Nginx
Containerization: Docker
Storage: Cloudflare R2 (planned)
Hosting: TBD
SSL: Let's Encrypt

---

# Folder Structure

```
Tulips.edu/
├── backend/
│   ├── api/v1/          Route handlers (auth, academic_years, classes, students,
│   │                    staff, attendance, fees, payments, superadmin,
│   │                    homework, timetable, exam)
│   ├── core/            security.py, events.py, csv_export.py
│   ├── db/              asyncpg pool
│   ├── middleware/      tenant.py
│   ├── models/          Pydantic models (auth, student, staff, finance, homework, timetable, exam)
│   ├── services/        Business logic (auth, student, staff, attendance, finance,
│   │                    payment, receipt, homework, timetable, exam)
│   ├── main.py
│   └── config.py
├── frontend/
│   ├── public/          sw.js, manifest.json
│   └── src/
│       ├── api/         HTTP client
│       ├── db/          IndexedDB abstraction
│       └── types/       TypeScript interfaces
├── migrations/          001_tenants … 015_exam_terms_marks (versioned SQL)
├── scripts/             apply_migrations.py, seed_tenant.py
├── tests/
├── docs/
├── docker-compose.yml
└── nginx.conf
```

---

# Multi-Tenant Architecture

Strategy: Shared database, logical isolation by `tenant_id`.

Tenant resolution (in order):
1. `X-Tenant-Slug` request header (local dev / testing override)
2. Subdomain: `school1.tulipsedu.in` → slug = `school1`

Every request to a protected endpoint:
1. Middleware resolves slug → tenant row → sets `request.state.tenant_id`
2. JWT is decoded; `tenant_id` claim must match resolved tenant
3. Mismatch → 403 (logged with warning)

JWT-exempt paths (tenant resolution still runs, JWT validation skipped):
- `/api/v1/auth/login`
- `/api/v1/auth/refresh`
- `/api/v1/auth/logout`

Fully exempt paths (no DB lookup):
- `/health`

---

# Role-Based Access Control (RBAC)

Roles are signed into the JWT at login (`services/auth.py`) and exposed by the
tenant middleware as `request.state.user_role`. The middleware enforces tenant
isolation; per-route role enforcement lives in `backend/core/rbac.py`.

Two guard primitives:
- `require_roles(*allowed)` — coarse gate dependency. 403s unless the caller's
  role is permitted. `superadmin` is implicitly allowed everywhere. Applied at
  router level (`APIRouter(..., dependencies=[...])`) or per-route for finer
  read/write splits.
- `load_class_scope` + `assert_in_scope(request, class_id, section_id)` — fine
  gate. For teaching roles, resolves user → staff → `staff_class_assignments`
  and records the allowed `(class_id, section_id)` set on `request.state`.
  Admin-tier roles (superadmin/principal/vice_principal) are unrestricted.
  Handlers call `assert_in_scope` to reject writes outside a teacher's classes.

Role → module access (the boundary; the frontend mirrors this for display only):

| Module | superadmin | principal | vice_principal | class_teacher | teacher | accountant |
|---|---|---|---|---|---|---|
| dashboard | ✓ | ✓ | ✓ | — | — | — |
| students | ✓ | ✓ | ✓ | — | — | — |
| staff (write) | ✓ | ✓ | view | — | — | — |
| attendance | ✓ | ✓ | ✓ | own classes | own classes | — |
| fees (write) | ✓ | ✓ | view | — | — | ✓ |
| payments | ✓ | ✓ | view | — | — | ✓ |
| homework | ✓ | ✓ | ✓ | own classes | own classes | — |
| timetable (write) | ✓ | ✓ | ✓ | read | read | — |
| exams (setup) | ✓ | ✓ | ✓ | marks only | marks only | — |
| cms | ✓ | ✓ | — | — | — | — |
| superadmin | ✓ | — | — | — | — | — |

Defence in depth: the role gate blocks the route; the service query still filters
by `tenant_id` (and, for teachers, the injected class scope). The webhook routes
under `/payments/webhooks/` carry no role (JWT-exempt) and are therefore guarded
per-route, never at the router level.

Parents authenticate via a separate path (admission number, no users row) and
never reach these staff routes.

---

# Core Database Schema

## schema_migrations

Purpose: Migration tracking (managed by apply_migrations.py)

Fields:
* version (PK)
* applied_at

---

## tenants

Purpose: Institution registry

Fields:
* id (UUID PK)
* slug (VARCHAR 63, UNIQUE)
* name (VARCHAR 255)
* institution_type (VARCHAR 50, default 'school')
* feature_flags (JSONB)
* upi_id (VARCHAR 100, nullable) — school UPI VPA for parent QR fee payments (migration 021)
* created_at

---

## users

Purpose: Staff and admin accounts. Phone number is the login identifier.

Fields:
* id (UUID PK)
* tenant_id (FK → tenants.id CASCADE)
* phone_number (VARCHAR 15)
* password_hash (VARCHAR 255)
* role (VARCHAR 50) — constrained by `users_role_check` (migration 018) to one of:
  'superadmin', 'principal', 'vice_principal', 'class_teacher', 'teacher', 'accountant'.
  Legacy 'admin' rows were migrated to 'principal' in 018. Parents are NOT users
  rows (separate adm_no auth path), so 'parent' is intentionally excluded here.
* is_active (BOOLEAN)
* created_at

Indexes:
* UNIQUE (tenant_id, phone_number)
* (tenant_id, created_at)
* (tenant_id, role)

CHECK:
* users_role_check (migration 018) — locks the role vocabulary above.

---

## audit_events

Purpose: Immutable event log. Never updated, never deleted.

Fields:
* id (BIGSERIAL PK)
* tenant_id (FK → tenants.id CASCADE)
* event_type (VARCHAR 100)
* payload (JSONB)
* created_at

---

## academic_years

Fields: id, tenant_id, name, start_date, end_date, is_current

Indexes: UNIQUE (tenant_id, name); (tenant_id, is_current)

---

## classes

Fields: id, tenant_id, academic_year_id, name, display_order

---

## sections

Fields: id, tenant_id, class_id, name

---

## students

Fields: id, tenant_id, academic_year_id, class_id, section_id, admission_no, first_name, last_name, roll_number, date_of_birth, gender, phone_number, parent_phone, address, is_hosteler, is_active, created_at

Constraints:
* UNIQUE (tenant_id, admission_no)
* UNIQUE (tenant_id, section_id, roll_number)

Indexes:
* (tenant_id, academic_year_id, class_id, section_id, is_active) — ClassSwipe

---

## staff

Fields: id, tenant_id, employee_id, first_name, last_name, phone_number, role, subject_specialization, is_active, created_at

Constraints: UNIQUE (tenant_id, employee_id)

---

## attendance_sessions

Fields: id, tenant_id, class_id, section_id, academic_year_id, date, period, opened_by, submitted_at, created_at

---

## attendance_records

Fields: id, tenant_id, session_id, student_id, status (present/absent/late), marked_by, created_at

---

## fee_structures

Fields: id, tenant_id, academic_year_id, name, is_active

---

## fee_items

Fields: id, tenant_id, fee_structure_id, name, amount, due_date, is_optional

---

## student_fees

Fields: id, tenant_id, student_id, fee_structure_id, total_amount, paid_amount, balance, status

---

## payments

Fields: id, tenant_id, student_id, fee_structure_id, amount, payment_method, reference_no, collected_by, created_at

---

## receipts

Fields: id, tenant_id, payment_id, receipt_number, issued_at

---

## homework_posts

Fields: id, tenant_id, academic_year_id, class_id, section_id, staff_id, subject, post_type (homework/announcement/resource), title, description, due_date, attachment_urls (JSONB), is_active, created_at

Indexes:
* (tenant_id, class_id, section_id, created_at DESC)
* (tenant_id, staff_id, created_at DESC)
* (tenant_id, academic_year_id, created_at DESC)

---

## timetable_slots

Fields: id, tenant_id, academic_year_id, class_id, section_id, day_of_week (1–6), period_number (1–12), start_time, end_time, subject, staff_id, room, created_at

Constraints: UNIQUE (tenant_id, academic_year_id, class_id, section_id, day_of_week, period_number)

Indexes:
* (tenant_id, academic_year_id, class_id, section_id)
* (tenant_id, staff_id)

---

## exam_subjects

Fields: id, tenant_id, academic_year_id, class_id, name, subject_code, sort_order, is_active, created_at

Constraints: UNIQUE (tenant_id, academic_year_id, class_id, name)

---

## exam_terms

Fields: id, tenant_id, academic_year_id, name, term_type (unit_test/half_yearly/annual/practical/project/internal), start_date, end_date, is_published, sort_order, created_at

Constraints: UNIQUE (tenant_id, academic_year_id, name)

---

## parents

Fields: id, tenant_id, phone_number, name, otp_hash, otp_expires_at, last_login_at, is_active, created_at

Indexes: UNIQUE (tenant_id, phone_number); (tenant_id, is_active)

Note: OTP is bcrypt-hashed, TTL 10 minutes. Auto-linked to students where students.parent_phone matches.

---

## parent_students

Fields: parent_id (FK → parents), student_id (FK → students), relationship (default 'parent')

Primary Key: (parent_id, student_id)

---

## cms_pages

Fields: id, tenant_id, slug, title, content_html, meta_description, is_published, sort_order, updated_at, created_at

Constraints: UNIQUE (tenant_id, slug)

Indexes: (tenant_id, is_published, sort_order)

---

## cms_announcements

Fields: id, tenant_id, title, body, is_published, published_at, expires_at, created_at

Indexes: (tenant_id, is_published, published_at DESC)

---

## exam_marks_config

Fields: id, tenant_id, exam_term_id, exam_subject_id, max_marks, passing_marks (default 33), weightage (default 100), created_at

Constraints: UNIQUE (tenant_id, exam_term_id, exam_subject_id)

---

## mark_entries

Fields: id, tenant_id, student_id, exam_term_id, exam_subject_id, marks_obtained, is_absent, remarks, entered_by, created_at, updated_at

Constraints: UNIQUE (tenant_id, student_id, exam_term_id, exam_subject_id)

Grade scale (CBSE): A1≥91, A2≥81, B1≥71, B2≥61, C1≥51, C2≥41, D≥33, E<33

---

# Event Catalog

> **Current state: producers only.** `core/events.py::emit()` writes each event to
> `audit_events` inside the state-changing transaction and stops there. No consumer reads
> them, so today this is an audit log, not a bus. **Target (ADR-010):** a background worker
> consumes events and dispatches to handlers (the "Producer → Triggers" column below is the
> intended wiring, none of which is built yet).
>
> | Event | Should trigger (target) |
> |---|---|
> | ATTENDANCE_MARKED / _CORRECTED (absent) | parent absent-alert notification |
> | FEE_COLLECTED | receipt notification to parent + reconciliation entry |
> | EXAM_PUBLISHED *(new)* | report-card PDF generation + parent notification |
> | HOMEWORK_ASSIGNED | parent "new homework" notification |
> | FEE_INSTALLMENT_OVERDUE *(new, scheduled)* | fee reminder to parent |
> | ADMISSION_APPROVED *(new)* | create student + assign fees + provision parent access |

## STAFF_AUTHENTICATED
Producer: services/auth.py
Payload: tenant_id, user_id

## STUDENT_CREATED
Producer: services/student.py
Payload: tenant_id, student_id

## STUDENT_UPDATED
Producer: services/student.py
Payload: tenant_id, student_id

## ATTENDANCE_MARKED
Producer: services/attendance.py
Payload: tenant_id, session_id, count

## ATTENDANCE_CORRECTED
Producer: services/attendance.py
Payload: tenant_id, session_id, count
Emitted instead of ATTENDANCE_MARKED when records are edited on a session that
was already submitted — distinguishes a correction from initial marking for audit.

## ATTENDANCE_SESSION_SUBMITTED
Producer: services/attendance.py
Payload: tenant_id, session_id

## FEE_COLLECTED
Producer: services/finance.py
Payload: tenant_id, student_id, amount, payment_id

## HOMEWORK_ASSIGNED
Producer: services/homework.py
Payload: tenant_id, post_id, class_id, section_id, post_type

## MARKS_ENTERED
Producer: services/exam.py
Payload: tenant_id, exam_term_id, count

## PARENT_LOGIN
Producer: services/parent.py
Payload: tenant_id, parent_id

---

# API Catalog

## Authentication

### POST /api/v1/auth/login — Implemented
### POST /api/v1/auth/refresh — Implemented
### POST /api/v1/auth/logout — Implemented

## Academic Structure

### POST /api/v1/academic-years — Implemented
### GET /api/v1/academic-years — Implemented
### PATCH /api/v1/academic-years/:id/set-current — Implemented
### POST /api/v1/classes — Implemented
### GET /api/v1/classes — Implemented
### POST /api/v1/classes/:id/sections — Implemented

## Students

### POST /api/v1/students — Implemented
### GET /api/v1/students — Implemented
### GET /api/v1/students/:id — Implemented
### PUT /api/v1/students/:id — Implemented
### DELETE /api/v1/students/:id — Implemented (soft-delete)

## Staff

### POST /api/v1/staff — Implemented
### GET /api/v1/staff — Implemented
### GET /api/v1/staff/:id — Implemented
### PUT /api/v1/staff/:id — Implemented
### DELETE /api/v1/staff/:id — Implemented (soft-delete)

## Attendance

### POST /api/v1/attendance/sessions — Implemented
### POST /api/v1/attendance/sessions/:id/marks — Implemented
### POST /api/v1/attendance/sessions/:id/submit — Implemented
### GET /api/v1/attendance/sessions/:id — Implemented
### GET /api/v1/attendance/report — Implemented
### GET /api/v1/attendance/report/csv — Implemented

## Finance

### POST/GET /api/v1/fees/structures — Implemented
### POST/GET /api/v1/fees/structures/:id/items — Implemented
### POST/GET /api/v1/fees/students — Implemented
### POST /api/v1/payments — Implemented
### GET /api/v1/payments/receipts/:id — Implemented
### GET /api/v1/superadmin/dashboard — Implemented

## Homework & Feed

### POST /api/v1/homework — Implemented
### GET /api/v1/homework — Implemented (filters: class_id, section_id, post_type, academic_year_id)
### PATCH /api/v1/homework/:id — Implemented
### DELETE /api/v1/homework/:id — Implemented (soft-delete)

## Timetable

### PUT /api/v1/timetable/slots — Implemented (upsert)
### DELETE /api/v1/timetable/slots — Implemented
### GET /api/v1/timetable/class — Implemented (weekly grid for class-section)
### GET /api/v1/timetable/staff/:id — Implemented (staff schedule)

## Examinations

### POST /api/v1/exams/subjects — Implemented
### GET /api/v1/exams/subjects — Implemented
### POST /api/v1/exams/terms — Implemented
### GET /api/v1/exams/terms — Implemented
### PATCH /api/v1/exams/terms/:id/publish — Implemented
### PUT /api/v1/exams/marks-config — Implemented (upsert)
### GET /api/v1/exams/marks-config — Implemented
### POST /api/v1/exams/marks — Implemented (bulk upsert)
### GET /api/v1/exams/marks — Implemented (by term + subject + class-section)
### GET /api/v1/exams/results/term — Implemented (term result sheet with grades)
### GET /api/v1/exams/results/consolidated — Implemented (weighted across published terms)

## Parent Portal

### POST /api/v1/parent/auth/request-otp — Implemented (public, no JWT)
### POST /api/v1/parent/auth/verify-otp — Implemented (public, no JWT; returns JWT with role=parent)
### GET /api/v1/parent/students — Implemented (lists students auto-linked by parent_phone)
### GET /api/v1/parent/students/:id/summary — Implemented (attendance %, fee balance, recent homework)

## CMS Admin

### POST /api/v1/cms/pages — Implemented
### GET /api/v1/cms/pages — Implemented (all pages including drafts)
### PUT /api/v1/cms/pages/:id — Implemented
### DELETE /api/v1/cms/pages/:id — Implemented
### POST /api/v1/cms/announcements — Implemented
### GET /api/v1/cms/announcements — Implemented (all including drafts)
### PUT /api/v1/cms/announcements/:id — Implemented
### DELETE /api/v1/cms/announcements/:id — Implemented

## Public CMS (no JWT required)

### GET /api/v1/public/school-info — Implemented
### GET /api/v1/public/pages — Implemented (published only)
### GET /api/v1/public/pages/:slug — Implemented (published only)
### GET /api/v1/public/announcements — Implemented (active + not expired)

## File Uploads

### POST /api/v1/uploads/url — Implemented (R2 presigned PUT URL; returns 501 until R2 configured)

---

# Third-Party Integrations

## Cloudflare R2
Purpose: Document and media storage
Status: Planned

## SMS Provider
Purpose: Parent notifications
Status: Planned

## Payment Gateway (Razorpay)
Purpose: Online fee collection
Status: Planned

---

# Deployment Topology

```
Internet
  ↓
Cloudflare (DNS + proxy + Universal SSL, terminates browser TLS)
  ↓
Nginx (origin, host-based routing)
  ├─ tulipsedu.in / www.tulipsedu.in  → static marketing landing page (index.html)
  └─ <slug>.tulipsedu.in              → Preact SPA + /api proxy → FastAPI
  ↓
FastAPI (port 8000)
  ↓
PostgreSQL (port 5432)
  ↓
Background Workers (TBD)
  ↓
Cloudflare R2
```

Apex marketing site: a single self-contained `index.html` (inline CSS/JS, Google-CDN
fonts) bind-mounted into the nginx container at `/usr/share/nginx/landing` and served by
a dedicated `server_name tulipsedu.in www.tulipsedu.in` 443 block. Exact server_name
matches win over the tenant regex block, so the apex serves marketing while every
`*.tulipsedu.in` subdomain continues to serve the SPA (still the nginx default server).
No backend, migration, dependency, or cert change — the existing origin cert is reused.

Local dev: `docker compose up postgres` + `uvicorn main:app --reload --port 8000` + `npm run dev`

---

# Performance Constraints

Frontend Bundle: < 2 MB
Attendance: Offline-first
List Rendering: Virtualized above 50 rows
Media: Presigned uploads only
Database: Tenant-first indexing on all composite indexes
API: Async only (no blocking I/O in request handlers)

---

# Security Rules

* Tenant isolation on every request (middleware enforced)
* JWT tenant_id claim validated against subdomain on every protected request
* Password hashing: bcrypt
* No plaintext secrets in source or logs
* No PII in log output
* Audit events are immutable (append-only)
* File uploads via presigned URLs only (when implemented)

---

# Major Architectural Decisions

## ADR-010 — Event-bus worker via transactional outbox (PROPOSED — needs approval)

**Context:** `audit_events` is written by every state change but read by nothing. The
event-driven architecture mandated by CLAUDE.md has producers and no subscribers, so no
cross-module workflow, notification, or async (202) feature can exist.

**Decision (proposed):** Adopt the **transactional outbox** pattern over the existing
table — the producer already writes the event in the same transaction as the state change,
which is exactly the outbox guarantee. Add dispatch bookkeeping (`status`,`attempts`,
`processed_at`,`available_at`) and run a **single in-repo background worker** that claims
unprocessed rows (`FOR UPDATE SKIP LOCKED`), dispatches to a handler registry, and marks
them done/failed with retry/backoff. Start with Postgres polling (no new infra); add
`LISTEN/NOTIFY` only if latency demands it. The same worker runs the **scheduler** for
time-based triggers (fee due/overdue, daily digests).

**Why not a queue broker (Redis/RabbitMQ/Celery):** violates the ₹2,000/month and
single-codebase constraints; Postgres-as-queue is sufficient at 500–5,000 students/tenant.

**Approval gates this trips (do NOT implement until cleared):**
- Deployment topology — adds a `worker` service to `docker-compose.prod.yml`.
- Schema change — outbox columns + `notifications` table (+ later admissions / lifecycle).
- Dependencies — none required for the poller; PDF (report cards) and SMS/WhatsApp adapters
  are separate gates (PDF lib = dependency; SMS = paid service).

**Consequence:** unblocks every Phase-2 workflow (absent alerts, fee reminders, report
cards, admissions orchestration, year rollover) on one shared mechanism.

---

# Future Decisions

Reserved for approved architectural changes.
