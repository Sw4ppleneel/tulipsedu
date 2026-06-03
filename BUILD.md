# BUILD.md

# Project Status

Project: Tulips.edu
Phase: Phase 1 MVP — Post-Launch Iteration
Current Sprint: Sprint 2 — RBAC, UX Fixes, Payment, Exam Structure
Last Updated: 2026-06-04

---

# PROJECT STATE

Current Phase: Phase 1 MVP (deployed to production)
Current Sprint: Sprint 2 — Role-Based Access, UX Overhaul, Exam Restructure, Fee Excel Import, Payment QR

Completed:
- Auth + Tenant Isolation
- Student Management
- Staff Management
- ClassSwipe Attendance
- Finance (fee heads, ledger, payments)
- Homework & Classroom Feed
- Timetable Engine
- Examination Management
- Parent Portal (OTP, student summary)
- CMS (pages + announcements)
- Dashboard
- Production deployment (*.tulipsedu.in, 4 schools seeded)
- R2 upload endpoint (501 until credentials added)

In Progress: Sprint 2 planning (this document)

Blocked:
- R2 credentials not yet added to production .env
- SMS provider (OTP in dev mode only)

Next Task: RBAC implementation (user roles: principal, teacher, accountant) + UI app split

---

# Sprint 2 — Backlog

## BUG: Roll Number Not Unique Per Class
**Problem:** Two students can share a roll number in the same class/section.
**Fix:** Migration — add unique constraint `(tenant_id, academic_year_id, class_id, section_id, roll_number)`.
**Status:** Needs migration + backend validation.

## BUG: Timetable Missing Teacher Field
**Problem:** Slot entry form has no field for teacher name/assignment.
**Fix:** Add `staff_id` FK to `timetable_slots`. Update API + frontend slot form with teacher dropdown.
**Status:** Needs migration + backend + frontend.

## BUG: Attendance Cannot Be Updated After Submit
**Problem:** Once attendance session is marked submitted=TRUE, no edit possible.
**Fix:** Allow PATCH/PUT on individual attendance records even after session is submitted. Remove the submit-lock on edits (keep audit trail).
**Status:** Backend service + frontend UI change.

## FEAT: Fee System — Excel Import Only
**Problem:** Manual fee entry UI is too complex and broken (doesn't load on add).
**Decision:** Remove all manual fee entry. Fee structures must be imported via Excel/CSV only.
**New flow:**
1. Admin uploads Excel: columns = student_roll, fee_head, amount, due_date, installment
2. Backend parses, validates, inserts into fee_ledger in bulk
3. View-only table in UI for fee ledger
4. Collection still via receipt entry (cash/UPI/cheque)
**Status:** Needs new upload endpoint + parser + simplified UI.

## FEAT: Exam Mark Categories Per Term
**Problem:** Current exam system has flat marks per subject. CBSE requires breakdown.
**New model:**
- Each exam term has `mark_components`: e.g., Unit Test (10), Oral (10), Theory (80) → total 100
- Teachers enter marks per component
- System sums and computes grade
**CBSE standard:** 80 theory + 20 internal (periodic tests 10 + notebook 5 + enrichment 5)
**Status:** Needs migration for exam_components table + API rewrite + frontend marks entry grid.

## FEAT: RBAC — Role-Based Access Control
**Roles required (Phase 1):**
- `superadmin` — platform-level, already exists
- `principal` — full school access (current admin role, rename)
- `teacher` — own assigned classes only: attendance + homework
- `class_teacher` — same as teacher + can view class student list
- `accountant` — fees module only
- `parent` — already implemented (parent portal)

**App split:**
- `[subdomain].tulipsedu.in` (no path) — public school website (CMS, already routes correctly)
- `[subdomain].tulipsedu.in/app` — staff app (principal/teacher/accountant login)
- `[subdomain].tulipsedu.in/parent` — parent app (OTP login, student summary, fee QR)

**Staff login flow:**
- Single login page with dropdown: Principal / Teacher / Accountant
- Backend: existing staff user records get a `role` field
- Frontend: show only permitted nav tabs based on role
  - Principal: dashboard, students, staff, attendance, fees, homework, timetable, exams, cms
  - Teacher: attendance (own classes), homework (own classes)
  - Accountant: fees only

**Status:** Needs DB migration (add role column to users), middleware role propagation, frontend nav gating.

## FEAT: Parent Fee Payment — UPI QR Code
**Flow:**
1. Parent taps a fee installment in the portal
2. Modal shows: amount due, school's UPI ID, dynamic QR code
3. Parent pays via any UPI app (Google Pay, PhonePe, Paytm, BHIM)
4. Manual reconciliation by accountant (mark as paid in fees module)
5. Future: Razorpay webhook auto-reconciliation

**Implementation:**
- Store `upi_id` on tenant record (migration)
- Frontend: generate QR using `qrcode` library (small, ~5 kB) with UPI deep link format:
  `upi://pay?pa=SCHOOL_UPI_ID&pn=SCHOOL_NAME&am=AMOUNT&cu=INR&tn=Fee%20Payment`
- No payment gateway needed for Phase 1 (manual reconciliation)

**Status:** Needs migration (upi_id on tenants) + frontend QR modal.

## FEAT: Teacher Class Assignment
**Model:** Each teacher (staff record) is assigned to one or more sections as class teacher.
**New table:** `class_teacher_assignments (tenant_id, staff_id, class_id, section_id, academic_year_id)`
**Status:** Needs migration + API + frontend admin assignment screen.

---

# Prioritized Implementation Order

1. **RBAC roles + nav gating** (unblocks teacher/accountant login)
2. **Attendance edit-after-submit** (immediate teacher pain point)
3. **Roll number uniqueness** (data integrity)
4. **Timetable teacher field** (UX gap)
5. **Fee Excel import** (replace broken UI)
6. **Parent UPI QR** (parent-facing value)
7. **Exam mark categories** (exam restructure, most complex)

---

# Completed

## 2026-06-03 — Parent Portal + CMS + Production Infrastructure

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
- backend/.env.example, backend/Dockerfile.prod, scripts/entrypoint.sh
- docker-compose.prod.yml, nginx.prod.conf (SSL, rate limiting, security headers)
- Dynamic CORS config (regex for wildcard subdomains)

## 2026-06-03 — Homework, Timetable, Examination Backend + Frontend

Full backend and frontend for three modules: HomeworkView, TimetableView, ExamView

## 2026-06-03 — Finance Module

Full Finance vertical slice: fee structures, payments, receipts, superadmin panel

## 2026-06-03 — Staff Management + ClassSwipe Attendance

Full Staff Management and ClassSwipe Attendance vertical slices

## 2026-06-03 — Student Management

Full Student Management vertical slice with VirtualList frontend

## 2026-06-03 — Sprint Foundation

Project scaffold, Docker, migration framework, auth, tenant isolation, Preact frontend shell

---

# Architectural Decisions

## ADR-001 — Single multi-tenant monolith (Approved)
## ADR-002 — Offline-first attendance (Approved)
## ADR-003 — Cloudflare R2 for file storage (Approved)
## ADR-004 — X-Tenant-Slug header for local dev (Approved)
## ADR-005 — OTP parent auth (no password) (Approved)
## ADR-006 — Parent-student auto-link by phone (Approved)
## ADR-007 — Fee structure via Excel import only (Proposed — Sprint 2)
**Reason:** Manual UI too complex for field use; Excel already the school's existing format.
## ADR-008 — UPI QR code for parent payments, no gateway in Phase 1 (Proposed — Sprint 2)
**Reason:** Zero MDR on UPI; manual reconciliation acceptable for pilot schools; Razorpay in Phase 2.
## ADR-009 — RBAC via role column on users table (Proposed — Sprint 2)
**Reason:** Simple column-level role with middleware propagation; no need for full permission table at MVP scale.

---

# Known Issues

- Fee add form broken (doesn't load) — will be replaced by Excel import
- Roll numbers not unique within class — pending migration
- Attendance locked after submit — pending fix
- Timetable has no teacher assignment — pending migration + UI

---

# Blockers

- R2 credentials for production file uploads
- SMS provider for production OTP delivery

---

# Pending Post-Launch

- SSL auto-renew cron: `certbot renew --quiet && docker compose -f ~/tulips/docker-compose.prod.yml exec nginx nginx -s reload`
- R2 env vars: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL
