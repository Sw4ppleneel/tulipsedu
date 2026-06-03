# BUILD.md

# Project Status

Project: Tulips.edu

Phase:
Phase 1 MVP

Current Sprint:
Homework, Timetable & Examination modules

Status:
In Progress

Last Updated:
2026-06-03

---

# Current Objectives

## Sprint Goal

Complete Homework/Feed, Timetable Engine, and Examination Management vertical slices.

Deliverables:

* Homework & Feed API + migrations ✓
* Timetable Engine API + migrations ✓
* Examination Management API + migrations ✓
* Frontend views for Homework, Timetable, Examinations (pending)

---

# Current TODO

## High Priority

* [x] migrations/012_homework.sql
* [x] migrations/013_timetable.sql
* [x] migrations/014_exam_subjects.sql
* [x] migrations/015_exam_terms_marks.sql
* [x] backend/models/homework.py + services/homework.py
* [x] backend/models/timetable.py + services/timetable.py
* [x] backend/models/exam.py + services/exam.py
* [x] backend/api/v1/homework.py — 4 endpoints
* [x] backend/api/v1/timetable.py — 4 endpoints
* [x] backend/api/v1/exam.py — 12 endpoints
* [x] router.py wired with homework, timetable, exam routers
* [ ] Frontend: HomeworkFeed view (post list + create form)
* [ ] Frontend: TimetableView (week grid per class-section)
* [ ] Frontend: ExamView (marks entry + result sheet)

## Medium Priority

* [ ] Parent Portal vertical slice
* [ ] CMS vertical slice

## Low Priority

* [ ] CI/CD pipeline
* [ ] Monitoring setup
* [ ] Backup automation

---

# In Progress

Frontend views for Homework, Timetable, Examinations

---

# Completed

## 2026-06-03 — Homework, Timetable, Examination Backend

### Work Completed

Full backend for three modules:
- Migration 012: homework_posts table (JSONB attachment_urls, post_type CHECK)
- Migration 013: timetable_slots table (UNIQUE per tenant/year/class/section/day/period)
- Migration 014: exam_subjects table (per class per academic year)
- Migration 015: exam_terms, exam_marks_config, mark_entries tables
- services/homework.py: create, list (filtered), update, soft-delete
- services/timetable.py: upsert slot (ON CONFLICT), delete slot, weekly timetable, staff timetable
- services/exam.py: subjects CRUD, terms CRUD + publish toggle, marks config upsert, bulk mark entry upsert, term result computation, consolidated weighted result
- api/v1/homework.py: POST/GET/PATCH/DELETE /api/v1/homework
- api/v1/timetable.py: PUT/DELETE /api/v1/timetable/slots, GET /timetable/class, GET /timetable/staff/{id}
- api/v1/exam.py: 12 endpoints across subjects/terms/marks-config/marks/results
- router.py updated to include all three routers

### Events Added
- HOMEWORK_ASSIGNED
- MARKS_ENTERED

---

## 2026-06-03 — Finance Module

### Work Completed

Full Finance vertical slice:
- Fee structures, fee items, student fee assignments
- Payment collection with receipt generation
- Superadmin panel for cross-tenant financial reporting
- Migrations: fee_structures, fee_items, student_fees, payments, receipts
- APIs: fee structures CRUD, student fee management, payment collection, receipt retrieval
- Superadmin dashboard endpoint

### APIs Added
- POST/GET /api/v1/fees/structures
- POST/GET /api/v1/fees/structures/:id/items
- POST/GET /api/v1/fees/students
- POST /api/v1/payments
- GET /api/v1/payments/receipts/:id
- GET /api/v1/superadmin/dashboard

### Events Added
- FEE_COLLECTED

---

## 2026-06-03 — Staff Management + ClassSwipe Attendance

### Work Completed

Full Staff Management and ClassSwipe Attendance vertical slices:
- Staff CRUD with soft-delete
- ClassSwipe attendance: open session, mark attendance (bulk upsert), submit session
- CSV exports for attendance reports
- Migrations: staff, attendance_sessions, attendance_records
- JWT now carries user_id (sub claim) for attendance audit

### APIs Added
- POST/GET/GET/:id/PUT/:id/DELETE/:id /api/v1/staff
- POST /api/v1/attendance/sessions
- POST /api/v1/attendance/sessions/:id/marks
- POST /api/v1/attendance/sessions/:id/submit
- GET /api/v1/attendance/sessions/:id
- GET /api/v1/attendance/report
- GET /api/v1/attendance/report/csv

### Events Added
- ATTENDANCE_MARKED
- ATTENDANCE_SESSION_SUBMITTED

---

## 2026-06-03 — Student Management

### Work Completed

Full Student Management vertical slice:
- Migrations 004 (academic_years), 005 (classes, sections), 006 (students)
- roll_number column with CONSTRAINT unique_tenant_section_roll
- CONSTRAINT unique_tenant_admission_no
- ClassSwipe composite index on (tenant_id, academic_year_id, class_id, section_id, is_active)
- 10 API endpoints: academic years, classes, sections, students (CRUD + soft-delete)
- Events: STUDENT_CREATED, STUDENT_UPDATED
- JWT now carries tenant_slug claim
- Frontend: VirtualList (zero deps), StudentsView, StudentForm, AppShell

### APIs Added
- POST/GET /api/v1/academic-years
- PATCH /api/v1/academic-years/:id/set-current
- POST/GET /api/v1/classes
- POST /api/v1/classes/:id/sections
- POST/GET/GET/:id/PUT/:id/DELETE/:id /api/v1/students

### Events Added
- STUDENT_CREATED
- STUDENT_UPDATED

---

## 2026-06-03 — Sprint Foundation

### Work Completed

Full project scaffold:
- Repository structure, Docker, migration framework
- PostgreSQL schemas: tenants, users, audit_events
- Backend: FastAPI app, asyncpg pool, pydantic-settings config
- Tenant isolation middleware: subdomain extraction + JWT tenant claim validation
- Auth endpoints: login, refresh, logout
- Event audit framework (STAFF_AUTHENTICATED)
- Frontend: Preact + Vite + TypeScript shell, login form, API client, IndexedDB queue, service worker stub

### APIs Added
- POST /api/v1/auth/login
- POST /api/v1/auth/refresh
- POST /api/v1/auth/logout

### Events Added
- STAFF_AUTHENTICATED

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

Frontend views for Homework, Timetable, and Examinations.

Then: Parent Portal vertical slice.
