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

> **Update 2026-06-13 — the spine now exists.** The event-bus worker, notifications table,
> and the first five event-driven workflows + fee-overdue scheduler are built and verified
> locally (ADR-010, realised as cursor+DLQ). The assessment below describes the *pre-spine*
> state and what it diagnosed; the ✅ items are now resolved. Remaining gaps: lifecycle/state
> machines, cross-module orchestration (admissions, year rollover), and delivery adapters
> (SMS/WhatsApp/PDF). Deploy to prod is the next step.

## Honest assessment: this is a CRUD amalgamation, not yet a workflow ERP

Every module is a competent set of forms over its own tables, but the modules do not
drive processes across each other. The connective tissue was missing:

- ✅ **Events are write-only.** *(Resolved.)* `emit()` still INSERTs into `audit_events`
  (immutable), but the worker (`backend/worker/`) now consumes the stream via a cursor and
  dispatches to handlers. Producers finally have subscribers.
- ✅ **No background worker.** *(Resolved.)* `backend/worker/main.py` (compose `worker`
  service) polls the event stream and runs an hourly fee-overdue scan. Absent alerts, fee
  receipts/reminders, homework pings and exam-results notices now fire. (PDF/SMS still pending.)
- **No lifecycle/state machines.** Records are flat. There is no admission pipeline, no
  exam-term lifecycle (draft→open→locked→published), no fee escalation (due→overdue). *(Still open.)*
- **No cross-module orchestration.** Creating a student doesn't assign fees or provision
  parent access; there is no academic-year rollover (the flagship multi-step transaction
  named in CLAUDE.md); approving an admission doesn't exist. *(Still open.)*
- ✅ **No notifications table.** *(Resolved.)* `notifications` (migration 024) + staff/parent
  APIs + 🔔 bell / parent Updates card. Events are now pushed, not just pull-on-login.

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
Background Jobs: Event-consumer worker — `backend/worker/` (compose `worker` service,
`python -m worker.main`). Single instance, cursor-polls `audit_events` (at-least-once,
idempotent handlers via `notifications_dedup_idx`, dead-letter queue with capped exponential
backoff), plus an hourly fee-overdue scan. See ADR-010. SMS/email/PDF delivery adapters are
still TBD (paid-service + R2 gates).

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

Fields: id, tenant_id, academic_year_id, class_id, section_id, admission_no, first_name, last_name, roll_number, date_of_birth, gender, phone_number, parent_phone, address, is_hosteler, is_active, created_at, portal_password_hash (migration 039, nullable)

portal_password_hash: bcrypt hash of the parent-portal password. NULL = never
set — when the tenant has `feature_flags.parent_password`, login then accepts
the last 4 digits of parent_phone (derived at login, never persisted; rejected
when the phone is the 0000000000 placeholder).

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

## staff_class_assignments

Purpose: teacher ↔ class/section assignments (subject-teacher and/or class-teacher).

Fields: id, tenant_id, staff_id, academic_year_id, class_id, section_id, subject (nullable), is_class_teacher (default FALSE), created_at

Constraints:
* UNIQUE (tenant_id, academic_year_id, staff_id, class_id, section_id, subject) WHERE subject IS NOT NULL
* (Removed migration 041) previously UNIQUE on (tenant_id, academic_year_id, class_id, section_id) WHERE is_class_teacher — **multiple class teachers per section are now allowed** (owner request). `sca_class_teacher_idx` (non-unique) replaces it for lookup performance.

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

Fields: id, tenant_id, academic_year_id, name, term_type (unit_test/half_yearly/annual/practical/project/internal/term), start_date, end_date, is_published, status (draft/marks_open/locked/published), sort_order, created_at

Constraints: UNIQUE (tenant_id, academic_year_id, name)

---

## student_fee_discounts

Purpose: per-student percentage concessions (sibling discounts etc.), keyed by fee head (migration 040).

Fields: id, tenant_id, student_id, fee_head_id, percentage (NUMERIC(5,2), >0 and ≤100), reason (default 'sibling'), created_by, created_at

Constraints: UNIQUE (tenant_id, student_id, fee_head_id)

Setting/clearing recomputes the student's unpaid (pending/due/overdue) ledger
rows from the fee-schedule base amount in the same transaction — idempotent,
never compounds; paid/waived rows and schedule-less arrears untouched. Ledger
generation applies the percentage at insert time.

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

## exam_components

Fields: id, tenant_id, exam_term_id, exam_subject_id, name, max_marks, weightage (default 100), sort_order, created_at

Constraints: UNIQUE (tenant_id, exam_term_id, exam_subject_id, name)

Component marks roll up into mark_entries via weighted formula: SUM(marks/max * weightage) / SUM(weightage) * 100, producing a 0-100 subject total.

---

## exam_component_marks

Fields: id, tenant_id, student_id, exam_component_id, marks_obtained, is_absent, entered_by, created_at, updated_at

Constraints: UNIQUE (tenant_id, student_id, exam_component_id)

---

## exam_marks_config

Fields: id, tenant_id, exam_term_id, exam_subject_id, max_marks, passing_marks (default 33), weightage (default 100), created_at

Constraints: UNIQUE (tenant_id, exam_term_id, exam_subject_id)

When components are configured, max_marks is set to 100 (the weighted % total).

---

## mark_entries

Fields: id, tenant_id, student_id, exam_term_id, exam_subject_id, marks_obtained, is_absent, remarks, entered_by, created_at, updated_at

Constraints: UNIQUE (tenant_id, student_id, exam_term_id, exam_subject_id)

Grade scale (CBSE): A1≥91, A2≥81, B1≥71, B2≥61, C1≥51, C2≥41, D≥33, E<33

---

# Event Catalog

> **State (2026-06-13): producers + a real consumer.** `core/events.py::emit()` writes each
> event to `audit_events` (immutable, append-only) inside the state-changing transaction; the
> worker (`backend/worker/`) cursor-polls the stream and dispatches to handlers. The wiring
> below is now live (✅) except the delivery-dependent rows.
>
> | Event | Consumer handler | Status |
> |---|---|---|
> | ATTENDANCE_SESSION_SUBMITTED / ATTENDANCE_CORRECTED / ATTENDANCE_OVERRIDE | `attendance.absent_alert` → parent ABSENT notif (ref=session_id) | ✅ live |
> | FEE_PAID | `fees.receipt_push` → parent FEE_RECEIPT + accountant FEE_RECONCILE (ref=payment_id) | ✅ live |
> | REMINDER_SENT | `fees.manual_reminder` → parent FEE_OVERDUE w/ pending total (ref=reminder:{event_id}) | ✅ live |
> | FEE_PAYMENT_CLAIMED | `fees.payment_claimed` → accountants FEE_VERIFY (parent self-reported UPI; ref=payment_id) | ✅ live |
> | FEE_PAYMENT_REJECTED | `fees.payment_rejected` → parent FEE_REJECTED w/ reason (ref=payment_id) | ✅ live |
> | HOMEWORK_ASSIGNED | `homework.parent_ping` → section parents HOMEWORK notif (ref=post_id) | ✅ live |
> | EXAM_PUBLISHED | `exams.publish_notify` → parents w/ marks EXAM_PUBLISHED notif (ref=term_id) | ✅ live |
> | EXAM_MARKS_OPENED | no consumer (internal lifecycle signal) | ✅ emitted |
> | EXAM_MARKS_LOCKED | no consumer (internal lifecycle signal) | ✅ emitted |
> | EXAM_REOPENED | no consumer (principal override; internal audit) | ✅ emitted |
> | MONEY_RECONCILIATION_ALERT | no consumer (daily worker tripwire; payload = violation counts per tenant: double_pay / amount_mismatch / orphan_paid) | ✅ emitted |
> | SALARY_STRUCTURE_SET | no consumer (payroll audit signal; payload staff_id, gross_salary) | ✅ emitted |
> | PAYROLL_RUN_CREATED | no consumer (payroll audit signal; payload run_id, period, payslips) | ✅ emitted |
> | PAYROLL_FINALIZED | no consumer (payroll audit signal; payload run_id) | ✅ emitted |
> | *(scheduled, hourly)* `scheduler.fee_overdue_scan` | overdue monthly ledger → parent FEE_OVERDUE; emits FEE_OVERDUE_REMINDED | ✅ live |
> | EXAM_PUBLISHED | report-card **PDF** download (staff + parent; reportlab) | ✅ live (2026-06-18) |
> | ADMISSION_ENQUIRY_RECEIVED | no consumer (public web form → pipeline; staff act on board) | ✅ emitted |
> | ADMISSION_DOCUMENT_UPLOADED | no consumer (applicant attached a supporting doc; payload admission_id, document_name) | ✅ emitted |
> | ADMISSION_APPROVED | `admissions.enrol` orchestrated txn: create student + fee ledger + enrol | ✅ live |
>
> Idempotency: every notification insert is `ON CONFLICT DO NOTHING` against
> `notifications_dedup_idx (tenant_id, recipient_type, recipient_id, type, ref)`, so
> at-least-once delivery (cursor advances after handlers run) is safe. Failed handlers land in
> `worker_dlq` and retry with capped exponential backoff; a poison event never blocks the stream.

## STAFF_AUTHENTICATED
Producer: services/auth.py
Payload: tenant_id, user_id

## STAFF_ROLE_ASSIGNED
Producer: services/staff.py (set_staff_role)
Payload: tenant_id, staff_id, role, login_created
Principal-only. Assigns/changes a staff member's role (principal,
vice_principal, class_teacher, teacher, accountant). If the staff member has
no login yet, one is created (username = phone number, password = first 4
digits of phone + "@" + first name, same convention as the bulk staff
importer) and login_created=true.

## PASSWORD_CHANGED
Producer: services/auth.py (change_own_password), services/staff.py (reset_staff_password)
Payload: tenant_id, user_id or staff_id, by ("self" | "principal")
Two producers, one event: a staff member changing their own password
(PUT /auth/password, requires current password) and a principal
overriding any staff member's password from the dashboard
(PUT /staff/:id/password, principal-only, no current-password check —
that's the point of an admin override). The `by` field distinguishes
which path triggered it in the audit log.

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

## ADMISSION_DOCUMENT_UPLOADED
Producer: api/v1/admissions.py (public, token-gated)
Payload: tenant_id, admission_id, document_name
Emitted when a public applicant attaches a supporting document (e.g. matric
marksheet) to their enquiry. Feature-gated per tenant by `feature_flags.admission_docs`.

## PARENT_PASSWORD_CHANGED
Producer: services/parent.py (change_portal_password), services/student.py (reset_portal_password)
Payload: tenant_id, student_id, by ("parent" | "staff"), role (staff resets only)
Parent-portal password set/changed. Self-service requires the current password
(stored hash, or the last-4-of-phone default while none is set); staff resets
(class teacher for own class, principal/VP anywhere) skip the current-password
check. Audit-only, no worker consumer.

## FEE_WAIVED
Producer: services/fee_collection.py (waive_fees)
Payload: tenant_id, student_id, ledger_ids, total, reason, waived_by
Selected unpaid ledger rows marked 'waived' with a mandatory reason. A revenue
decision, not a payment — no fee_payments row, no receipt, never counted as
collected. Rows attached to a live payment claim cannot be waived. Audit-only.

## STUDENT_DISCOUNT_SET
Producer: services/finance.py (set_student_discounts)
Payload: tenant_id, student_id, discounts [{fee_head_id, percentage}], rows_updated, set_by
The student's discount set was replaced (empty = cleared) and their unpaid
ledger rows recomputed from schedule base amounts. Audit-only.

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
### PATCH /api/v1/students/:id/contact — Implemented (parent_phone only; teaching roles scope-checked to own class, admin tier unrestricted)
### PUT /api/v1/students/:id/portal-password — Implemented (staff reset of the parent-portal password; same scoping as /contact)
### DELETE /api/v1/students/:id — Implemented (soft-delete)

## Staff

### POST /api/v1/staff — Implemented
### GET /api/v1/staff — Implemented (response includes `role`, LEFT JOINed from `users`; null if no login yet)
### GET /api/v1/staff/:id — Implemented (same)
### PUT /api/v1/staff/:id — Implemented
### PUT /api/v1/staff/:id/role — Implemented (principal-only; assigns role, grants login on first assignment)
### PUT /api/v1/staff/:id/password — Implemented (principal-only; overrides a staff member's password directly, no current-password check)
### PUT /api/v1/auth/password — Implemented (any authenticated staff role; self-service change, requires current password)
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
### POST /api/v1/fees/waive — Implemented (principal/accountant; waive selected unpaid fees with mandatory reason — not counted as revenue)
### GET /api/v1/fees/discounts?student_id= — Implemented (principal/VP/accountant)
### PUT /api/v1/fees/discounts — Implemented (principal/VP; replaces student's discount set + recomputes unpaid ledger rows)
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

### POST /api/v1/exams/subjects — Implemented (principal/VP only)
### GET /api/v1/exams/subjects — Implemented (filters: academic_year_id, class_id)
### POST /api/v1/exams/terms — Implemented (principal/VP only)
### GET /api/v1/exams/terms — Implemented (filter: academic_year_id)
### PATCH /api/v1/exams/terms/:id/publish — Implemented (principal/VP only; legacy toggle)
### POST /api/v1/exams/terms/:id/status — Implemented (principal/VP only; transitions: draft→marks_open→locked→published, reopen paths)
### PUT /api/v1/exams/marks-config — Implemented (upsert; principal/VP only)
### GET /api/v1/exams/marks-config — Implemented (filter: exam_term_id)
### PUT /api/v1/exams/components — Implemented (configure components for term×subject; principal/VP only; clears removed ones)
### GET /api/v1/exams/components — Implemented (filters: exam_term_id, exam_subject_id)
### GET /api/v1/exams/component-marks — Implemented (component marks grid for term×subject×class×section)
### POST /api/v1/exams/component-marks — Implemented (save component marks; rolls up to mark_entries via weighted formula)
### POST /api/v1/exams/marks — Implemented (bulk upsert flat marks; validates marks ≤ max_marks)
### GET /api/v1/exams/marks — Implemented (by term + subject + class-section)
### GET /api/v1/exams/results/term — Implemented (term result sheet with grades)
### GET /api/v1/exams/results/consolidated — Implemented (weighted across published terms)
### GET /api/v1/exams/results/report-card.pdf — Implemented (staff download; any publish state; reportlab PDF)
### POST /api/v1/exams/import — Implemented (two-sheet xlsx: 'Subjects' + 'Terms'; principal/VP only)

## Parent Portal

### POST /api/v1/parent/auth/request-otp — Implemented (public, no JWT)
### POST /api/v1/parent/auth/verify-otp — Implemented (public, no JWT; returns JWT with role=parent)
### POST /api/v1/parent/auth/login — Implemented (public, no JWT; admission-number login; returns scoped parent JWT. Tenants with `feature_flags.parent_password` additionally require `password` — per-student hash, defaulting to last 4 digits of parent_phone)
### PUT /api/v1/parent/password — Implemented (parent JWT; self-service password change, requires current password)
### GET /api/v1/parent/students — Implemented (lists students auto-linked by parent_phone)
### GET /api/v1/parent/students/:id/summary — Implemented (attendance %, fee balance, recent homework)
### GET /api/v1/parent/students/:id/results/report-card.pdf — Implemented (published terms only; reportlab PDF)

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

### GET /api/v1/public/school-info — Implemented (includes `parent_password` so the parent-login UI knows to show the password field)
### GET /api/v1/public/pages — Implemented (published only)
### GET /api/v1/public/pages/:slug — Implemented (published only)
### GET /api/v1/public/announcements — Implemented (active + not expired)

## File Uploads

### POST /api/v1/uploads/url — Implemented (R2 presigned PUT URL; returns 501 until R2 configured)

## Admissions

### POST /api/v1/admissions/enquiry — Implemented (public, no JWT; tenant from slug). Returns `upload_token` when the tenant has `feature_flags.admission_docs`.
### POST /api/v1/admissions/documents/upload-url — Implemented (public; authorised by the admission upload token, not a user JWT). Feature-gated; PDF/JPG/PNG only; key `{tenant}/admissions/{admission_id}/{uuid}.{ext}`; 300s presigned PUT.
### POST /api/v1/admissions/documents/confirm — Implemented (public, token-gated). HEADs the object (≤5 MB, allowed type — else delete + 413) and appends {name,url,key} to `admissions.documents`; emits ADMISSION_DOCUMENT_UPLOADED.
### GET /api/v1/admissions — Implemented (staff: principal/VP; pipeline list)
### GET /api/v1/admissions/:id — Implemented (staff)
### PATCH /api/v1/admissions/:id/status — Implemented (staff; guarded transitions)
### POST /api/v1/admissions/:id/enrol — Implemented (principal; orchestrated student+ledger txn)

**Public-upload security model:** uploads are never proxied through the app. An applicant
submits the enquiry first (creating the row), receiving a 30-min HMAC-signed token scoped to
that one admission_id + tenant. The upload-url/confirm endpoints verify that token themselves
(they are JWT-exempt) and only mint URLs for the enquiry's own R2 prefix. Per-tenant gate via
`feature_flags.admission_docs` (currently: premchandmahtoic only).

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

# Frontend Portal Topology

Tulips.edu is composed as **role-specific portals over one backend**, not a single dashboard
with CSS-hidden menus. After login the SPA resolves a portal from the JWT role and renders a
dedicated shell that loads only that role's modules (smaller bundle + defense in depth; the
backend remains the real authorization boundary via `require_roles` + `load_class_scope`).

| Role | Portal / shell | Modules |
|---|---|---|
| principal / vice_principal | AppShell (admin) | full institution (students, staff, attendance, fees, timetable, exams, homework, CMS, settings) |
| teacher / class_teacher | **TeacherShell** | Today (scoped dashboard), Attendance, Homework, Timetable, Exams — assigned classes only |
| accountant | AppShell (fee-filtered) | fees only *(dedicated accountant shell = future slice)* |
| superadmin | AppShell (superadmin-only) | platform admin |
| parent | ParentPortalView | own children: attendance, fees, homework, results, Updates |

Teacher attendance is the **daily** Indian K-12 model (one record/student/day; no
period/subject attendance). Sessions lock at end of their IST calendar day; after lock only
principal/admin may edit and each edit emits `ATTENDANCE_OVERRIDE` (→ absent_alert, dedup-safe).

**Design system:** the public landing page (`index.html`) is the single source of truth for
the visual language. All portals inherit one token set in `frontend/src/globals.css`
(chalkboard-green primary, tulip accent, marigold; Bricolage Grotesque + Figtree via CDN with
`display=swap` + system fallback) and one primitive library in `frontend/src/ui/` (Brand,
Button, Card, Badge, SectionTile, Spinner, Empty/Error states). No second visual language,
no Material/Bootstrap/etc. Each portal's startup is a **big-button launcher** (`PortalHome`)
whose tiles open dedicated pages. Logo = configurable text wordmark (`Brand`, swappable via
`logoUrl` from tenant settings — no placeholder/generated image).

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
FastAPI (port 8000)  ──────┐
  ↓                        │ (same image, internal network)
PostgreSQL (port 5432) ←── Worker (python -m worker.main)
  ↓                          event consumer + hourly fee-overdue scan
Cloudflare R2                single instance, restart: unless-stopped
```

The `worker` compose service shares the backend image and env but overrides the entrypoint
to `python -m worker.main` (skips migrations + gunicorn — the backend owns migrations; the
worker blocks on `wait_for_migrations('024_worker_spine.sql')`). It holds its own small pool
(max 3) and is safe to stop anytime: events accumulate in `audit_events` and the cursor
resumes where it left off. Single instance by design (no row locking on the cursor).

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

## ADR-010 — Event-consumer worker over immutable audit_events (ACCEPTED — built 2026-06-13)

**Context:** `audit_events` is written by every state change but read by nothing. The
event-driven architecture mandated by CLAUDE.md has producers and no subscribers, so no
cross-module workflow, notification, or async (202) feature can exist.

**Decision (as built):** Run a **single in-repo background worker** that consumes the
`audit_events` stream and dispatches to a handler registry. The original sketch added outbox
status columns *to* `audit_events`; that was rejected because **`audit_events` is documented
immutable** (Security Rules). Instead the worker keeps its position in a separate
`worker_cursors` table (bootstrapped at `MAX(id)` so first deploy replays no history) and
parks failed handler runs in `worker_dlq` (capped exponential backoff). Delivery is
**at-least-once** — the cursor advances after an event's handlers run — made safe by
idempotent handlers (`ON CONFLICT DO NOTHING` against `notifications_dedup_idx`). Single
instance, so no `FOR UPDATE SKIP LOCKED` needed. Postgres polling (no new infra). The same
worker runs the **scheduler** for time-based triggers (hourly fee-overdue scan; digests later).

**Why not a queue broker (Redis/RabbitMQ/Celery):** violates the ₹2,000/month and
single-codebase constraints; Postgres-as-queue is sufficient at 500–5,000 students/tenant.

**Approval gates tripped (cleared by plan approval 2026-06-13):**
- Deployment topology — `worker` service added to `docker-compose.prod.yml`.
- Schema change — migration `024_worker_spine.sql` (worker_cursors, worker_dlq,
  notifications, fee_ledger.reminded_at). No columns added to audit_events.
- Dependencies — none (worker ships in the existing backend image). PDF (report cards) and
  SMS/WhatsApp adapters remain separate, *un-cleared* gates (PDF lib = dependency; SMS = paid).

**Consequence:** unblocks every Phase-2 workflow on one shared mechanism. Live as of
2026-06-13: absent alerts, fee receipts + reconcile, manual reminders, homework pings, exam
publish notices, fee-overdue scan. Still to build on it: lifecycle state machines, admissions
orchestration, year rollover, and the PDF/SMS delivery adapters.

## ADR-011 — Server-side PDF via reportlab + consolidated payroll (ACCEPTED — 2026-06-15)

**Context:** Two user-requested capabilities, each tripping a CLAUDE.md gate. (1) Accountants
need a *PDF* fee receipt to forward to parents (the existing receipt was HTML-only). (2) The
principal needs to set staff salaries and produce monthly payslips — **payroll is listed
OUT OF SCOPE** in CLAUDE.md.

**Decision (both explicitly approved by the user this session):**
- **PDF: `reportlab`** (pure-Python, no system libs — keeps the slim image small and the
  ₹2k/month VPS light; weasyprint was rejected for its cairo/pango footprint). Receipts and
  payslips render from **structured DB data**, not by parsing stored HTML. The built-in
  Helvetica lacks the ₹ glyph and the image ships no TTF, so amounts use `Rs.`.
- **Payroll: consolidated, no statutory engine.** Each staff has one salary structure
  (`gross + recurring allowance/deduction lines`); a monthly **run** snapshots a payslip per
  active staff (`net = gross + Σallowances − Σdeductions`); payslips are editable while the
  run is `draft` and frozen on `finalize`. **No PF/ESI/TDS auto-calculation** — those rules
  vary and most target schools pay consolidated salaries; statutory deductions, if any, are
  entered as manual lines. This bounds the out-of-scope expansion to a correct, low-maintenance
  module rather than a compliance engine.

**Approval gates tripped (cleared by user this session):**
- Dependency — `reportlab>=4.1` added to `backend/requirements.txt`.
- Schema — migration `031_payroll.sql` (`staff_salary_structures`, `staff_payroll_runs`,
  `staff_payslips`; all composite indexes lead with `tenant_id`).
- Scope — payroll, otherwise out of scope, admitted as a principal-only module.

**Endpoints:** `GET/PUT /payroll/staff/{id}/salary`, `GET /payroll/staff/{id}/payslips`,
`GET/POST /payroll/runs`, `GET /payroll/runs/{id}/payslips`, `POST /payroll/runs/{id}/finalize`,
`PATCH /payroll/payslips/{id}`, `GET /payroll/payslips/{id}.pdf`, plus
`GET /payments/{id}/receipt.pdf` for fee receipts. All payroll routes are **principal-only**;
receipt PDF is principal/vice_principal/accountant.

**Report-card PDF (W13, 2026-06-15):** generation is free (reportlab) — only *auto-delivery*
(W12, WhatsApp/SMS) needs paid creds. `services/report_card.py::build_report_card_context`
reuses `exam.compute_term_results` (PDF can't drift from the UI grade sheet); rendered by
`services/report_card_pdf.py`. Endpoints: `GET /exams/results/report-card.pdf` (staff, any
publish state) and `GET /parent/students/{id}/results/report-card.pdf` (parent, **published
terms only**). Download-and-forward — no R2, no migration, no new dependency.

**R2 usage:** credentials are live on prod. Current PDF flows do **not** use R2 (generated
on-demand, served as downloads). R2 is reserved for the **public-website photo gallery**
(planned) and, later, persisted/auto-delivered report cards. Object metadata/URLs in Postgres;
no binaries in app containers (File Upload Rules).

**Events:** SALARY_STRUCTURE_SET, PAYROLL_RUN_CREATED, PAYROLL_FINALIZED (audit-only, no
worker consumer yet).

## ADR-012 — Ironclad money integrity: DB double-pay guard + reconciliation tripwire (ACCEPTED — 2026-06-15)

**Context:** Fees are a legal/financial contract — a lost or duplicated rupee is unacceptable.
Concurrency safety on the payment paths (offline collect, parent UPI claim, gateway) was
**application-level only** (`SELECT … FOR UPDATE` on the ledger row + status re-check + a
dup-check). Proven correct under concurrency (10 simultaneous collects on one row → exactly one
succeeds; claim-vs-collect race → one wins; receipts unique; ₹ conserved — see
`backend/scripts/money_concurrency_test.py`), but a future code path that forgot the lock could
silently reintroduce double-pay.

**Decision (user-approved):**
1. **DB-level double-pay guard** (migration 032): `UNIQUE (tenant_id, ledger_id)` on
   `fee_payment_items` — a fee row can belong to at most one payment line item, enforced by
   Postgres. The reject path and both live collectors (`fee_collection.record_offline_payment`,
   `parent_payment.submit_claim`) delete **dead** line items (rejected/failed/refunded/abandoned-
   gateway-`pending`) before inserting, so the guard never blocks a legitimate retry after a
   rejected/abandoned attempt. One-time migration cleanup removed dead-payment items first
   (verified 0 resulting duplicates).
2. **Daily reconciliation tripwire** (`worker/scheduler.py::money_reconciliation`, run at worker
   startup + every 24 h): scans the whole ledger for (a) any fee row in >1 live payment, (b)
   `paid` payment whose amount ≠ Σ its line items, (c) `paid` ledger row missing payment_id or
   without exactly one paid item. Each violation logs ERROR + emits MONEY_RECONCILIATION_ALERT.
   On first prod run it flagged 48 mock-seed rows marked `paid` with no payment record
   (`payment_id IS NULL`) — a seed artifact, not a code defect (the live code always sets
   payment_id + items atomically); fresh real-school tenants start clean.
3. **Pool sizing**: asyncpg `max_size` 10→20 (4 workers → 80 conns < Postgres max 100), `min_size`
   5 (warm) for the morning attendance/fee burst.

**Committed safeguards:** `backend/scripts/pipeline_smoke_test.py` (50 checks, all 5 POVs +
RBAC denials) and `backend/scripts/money_concurrency_test.py` (concurrency + ₹-conservation
invariants) — run against a throwaway tenant before each launch/deploy.

**Approval gate:** schema change (migration 032) — explicitly approved.

---

# Future Decisions

Reserved for approved architectural changes.
