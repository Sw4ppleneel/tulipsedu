# BUILD.md

# Project Status

Project: Tulips.edu
Phase: Phase 1 MVP shipped → pivoting to Phase 2 "Workflow ERP"
Current Sprint: Sprint 3 — Workflow Spine (event bus + worker + notifications)
Last Updated: 2026-06-12

---

# PROJECT STATE

Current Phase: Phase 1 MVP deployed to production; Phase 2 transformation starting
Current Sprint: Sprint 3 — turn the CRUD modules into driven workflows

Completed (Phase 1, all deployed to *.tulipsedu.in, 4 schools seeded):
- Auth + Tenant Isolation + RBAC (6 staff roles + parent, migration 018)
- Student / Staff Management
- ClassSwipe Attendance (offline-first, edit-after-submit)
- Finance (fee heads, schedules, ledger, payments, Excel import, UPI QR)
- Homework & Classroom Feed
- Timetable Engine (with teacher assignment — already has timetable_slots.staff_id)
- Examination Management (terms, subjects, mark components → grade rollup)
- Parent Portal (admission-number login, attendance/fee/homework summary, UPI QR pay)
- CMS (pages + announcements) + per-tenant public website at subdomain root
- Dashboard
- Apex marketing landing page at tulipsedu.in / www (2026-06-12)
- R2 upload endpoint (501 until credentials added)

In Progress: Phase 1 is feature-complete and shipped. The product is now a competent
**CRUD amalgamation** — see the assessment in ARCHITECTURE.md "Current Reality". The next
work is the **Workflow ERP Transformation** (final TODO below), which adds the connective
tissue: an event-bus worker, notifications, lifecycle state machines, and cross-module
orchestration. North-star write-up: top of ROADMAP.md. Decision: ADR-010 in ARCHITECTURE.md.

Next Task: Get approval for ADR-010 (worker + outbox schema), then Sprint 3 item W1.

---

# Workflow ERP Transformation — FINAL TODO

Goal: stop being a pile of forms; become a system that *drives school processes*. None of
this is a new module — it is the wiring that makes the existing modules act on each other.
Ordered so each step unblocks the next. ⛔ = trips a CLAUDE.md approval gate (stop & ask).

## Sprint 3 — The Spine (makes events do something)
- [ ] **W0. Commit the working tree.** 61 files are untracked (whole feature set lives only
      on disk + VPS). Get git to match reality before building on it.
- [ ] **W1. ⛔ Transactional outbox.** Migration: add `status,attempts,processed_at,
      available_at` to `audit_events`. `emit()` unchanged (already writes in-txn). [schema]
- [ ] **W2. ⛔ Background worker.** New `worker` service in docker-compose; asyncpg poller
      claims rows `FOR UPDATE SKIP LOCKED` → handler registry → mark done/failed + backoff.
      Postgres polling only, no broker. [deployment topology]
- [ ] **W3. ⛔ Notifications.** Migration: `notifications(tenant_id, recipient_scope,
      recipient_id, type, title, body, read_at, created_at)`. `GET /notifications`
      (in-app feed) + bell badge in the SPA + parent portal. [schema]
- [ ] **W4. ⛔ Feature flags.** Migration: `tenants.features JSONB DEFAULT '{}'` (mandated
      in CLAUDE.md, still unbuilt — 023 was the transport filter, not this). Nav renders
      enabled tabs only. [schema]

## Sprint 4 — Wire the first three workflows (prove the pattern, all in-app first)
- [ ] **W5. Attendance → absent alert.** Handler on ATTENDANCE_MARKED/_CORRECTED(absent)
      → parent notification. (No paid SMS yet — in-app/portal only.)
- [ ] **W6. Fee collected → receipt + reconciliation.** Handler on FEE_COLLECTED → parent
      receipt notification + accountant reconciliation record.
- [ ] **W7. Homework assigned → parent ping.** Handler on HOMEWORK_ASSIGNED.

## Sprint 5 — Lifecycle state machines (the "ERP" part)
- [ ] **W8. ⛔ Exam term lifecycle.** `status: draft→marks_open→locked→published` gates marks
      entry; publishing emits EXAM_PUBLISHED (meaningful for the first time). [schema]
- [ ] **W9. ⛔ Fee installment lifecycle + scheduler.** `pending→due→overdue→paid`; worker
      scheduler advances due→overdue and emits FEE_INSTALLMENT_OVERDUE → reminder. [schema]
- [ ] **W10. ⛔ Admissions pipeline (new).** `enquiry→application→docs→approved→enrolled`.
      The `approve` step is one orchestrated transaction: create student + assign fee
      schedule + provision parent access, emitting ADMISSION_APPROVED. [schema + R2 for docs]
- [ ] **W11. ⛔ Academic-year rollover.** The flagship multi-step transaction from CLAUDE.md:
      promote students, close/carry fee ledgers, archive the year, clone sections/timetable,
      flag the graduating batch — one explicit transaction, fully reversible. [schema]

## Sprint 6 — Delivery + polish (blocked on credentials / paid services)
- [ ] **W12. ⛔ SMS/WhatsApp delivery adapter** (MSG91 or WhatsApp Cloud API). The worker
      gains a delivery channel beyond in-app. [paid service + credentials — BLOCKED]
- [ ] **W13. ⛔ Report-card PDF.** EXAM_PUBLISHED → worker renders PDF → R2 → parent
      downloads. [dependency: PDF lib + R2 credentials — BLOCKED]
- [ ] **W14. Analytics aggregates** precomputed on write (fee recovery %, attendance
      trend, low-attendance <75% list) — no runtime heavy queries.

---

# Apex Marketing Landing Page (COMPLETED 2026-06-12, DEPLOYED)

The repo-root `index.html` is now the public marketing site for the apex domain
(`tulipsedu.in` + `www`), distinct from the per-tenant SPA at `*.tulipsedu.in`.

Problem: apex/www had no nginx server block, so they fell through to the tenant SPA
block (nginx default server) and served the broken Preact shell with no tenant.

Built (infra only — no backend/migration/dependency/cert change):
- nginx.prod.conf: new `server_name tulipsedu.in www.tulipsedu.in` 443 block, root
  `/usr/share/nginx/landing`, HTML no-cache, reuses the existing origin cert. Exact
  server_name beats the tenant regex; tenant block stays the 443 default. Apex/www also
  added to the port-80 → HTTPS redirect block.
- docker-compose.prod.yml: bind-mounts `./index.html` → `/usr/share/nginx/landing/index.html:ro`.
- index.html: self-contained landing page (inline CSS/JS, Google-CDN fonts, offline-
  attendance interactive demo). Chalkboard-green / tulip-red theme, system-font body.

Deployed: scp'd to ~/tulips, `nginx -t` clean, `docker compose up -d nginx`.
Verified PUBLICLY through Cloudflare:
- https://tulipsedu.in       → "Tulips — Run your school from one place" (HTTP 200)
- https://www.tulipsedu.in   → same marketing page
- https://daffodils.tulipsedu.in → still the SPA ("Tulips.edu"), /health 200 (proxy intact)

CTAs wired (2026-06-12): Book-a-demo buttons → `https://wa.me/917979732854` (prefilled
demo message, opens new tab); Email us → `mailto:swapneel.bit@gmail.com`. Redeployed and
verified live through Cloudflare. (Cloudflare Scrape Shield obfuscates the mailto into
`/cdn-cgi/l/email-protection#…` for scrapers — it decodes to the real address in a real
browser, so the link works for visitors.)

OPEN (optional): switch Email us to a branded `contact@tulipsedu.in` once Cloudflare
Email Routing is enabled (free; forwards to the Gmail). One-line index.html edit + re-scp.

---

# Public School Website + Path Routing (COMPLETED 2026-06-05)

Decision: path-based routing (no new subdomains/cert). One-page CMS-driven site.
- `school.tulipsedu.in/`       → public website (no login)
- `school.tulipsedu.in/app`    → staff ERP
- `school.tulipsedu.in/parent` → parent portal

Built:
- frontend/src/api/cms.ts: cmsPublic (schoolInfo/pages/announcements) — unauthenticated,
  tenant slug from subdomain or ?school= override (for localhost testing).
- frontend/src/views/PublicSite.tsx: one-page site — sticky header (school name + nav +
  login buttons), hero, Notices (announcements), CMS pages as sections (content_html),
  contact footer. System fonts, lightweight.
- frontend/src/app.tsx: AppMode gains 'public'; initialMode() routes by pathname;
  goStaffLogin/goParentLogin/goPublic use history.pushState; popstate listener (doesn't
  disrupt active sessions); parent logout → public, staff logout → /app login.

No backend change, no migration, no new dependency. nginx SPA fallback already serves
all paths → /app and /parent load the SPA which self-routes. Zero infra change.

Verified: /public/school-info + /public/pages + /public/announcements return seeded data
(Daffodils: "About Us" page + welcome announcement). Frontend tsc+build clean (42.21 kB gzip).
Browser render not driven (no headless browser); data path + routing logic verified.

REMAINING for a fuller site (optional): gallery/photos (needs R2), per-page routing,
contact fields on tenants (address/phone — currently via a CMS 'contact' page).

---

Blocked:
- R2 credentials not yet added to production .env (uploads return 501 until then)

Next Task: (superseded) — all of Sprint 2 shipped to prod. See the Workflow ERP
Transformation FINAL TODO near the top of this file for the current direction.

---

# Step 5 — Exam Mark Components (COMPLETED 2026-06-05)

Existing exam engine = one mark per (term, subject) via exam_marks_config + mark_entries.
Added a components layer that rolls up into mark_entries so the results/grade engine
is untouched.

- Migration 022: exam_components (per term-subject: name, max_marks, sort_order) +
  exam_component_marks (per student per component). Applied.
- services/exam.py: configure_components (defines components, mirrors total into
  exam_marks_config), save_component_marks (upserts component marks + rolls the SUM
  into mark_entries in one transaction), get_component_marks_grid, list_components.
- api/v1/exam.py: PUT /exams/components (setup: principal/vp), GET /exams/components,
  GET+POST /exams/component-marks (teachers).
- frontend Exam.tsx: marks entry now loads components per term+subject; component
  config editor (Unit Test 10 + Oral 10 + Theory 80 = 100) + multi-column grid with
  auto Total. Falls back to flat single-mark entry when no components defined.

Verified live: configure UT10/Oral10/Theory80 → save 8/9/70 → grid total 87/100 →
term result Math 87/100 grade A2 (rollup into results engine works). Test term cleaned up.

---

# Parent Admission-Number Auth (COMPLETED 2026-06-05)

Replaces OTP for Phase 1 (OTP needs SMS, untestable). Parent logs in with the
student's permanent admission_no; JWT is scoped to that one student (sub=student_id).

- services/parent.py: login_by_admission_no (lookup student by adm_no → mint parent
  JWT), get_student_basic, get_student_summary_by_id (no parent_students link).
- api/v1/parent_auth.py: POST /parent/auth/login {admission_no}. (OTP endpoints left
  in place but unused by the frontend.)
- api/v1/parent.py: _require_parent returns student_id; /parent/students returns the
  one student; summary verifies the path id matches the session (403 otherwise).
- middleware/tenant.py: /parent/auth/login added to JWT-exempt.
- frontend: ParentLogin is now a single admission-number field; app.tsx + api/parent.ts
  updated. "Parent Login" button (was "Parent Login (OTP)").

Verified live: login DAFF001 → "Kabir Singh" + scoped token; own summary 200, other
student 403, invalid adm-no 401, staff route 403.

NOTE: parents + parent_students tables (migration 016) are now unused by the Phase 1
flow. Left in place; can be dropped in a later migration.

---

# Step 4b — Parent UPI QR + School Settings (COMPLETED 2026-06-05)

Decisions (user): QR + tappable upi:// link; migration 021 = upi_id only (discount deferred).

What was built:
- Migration 021 (`021_tenant_upi.sql`): `tenants.upi_id VARCHAR(100)` nullable. Applied.
- backend/api/v1/settings.py (NEW): GET /settings (principal/vp/accountant),
  PATCH /settings/upi (principal only) with VPA format validation (name@bank).
  Registered in router.py.
- backend/models/parent.py + services/parent.py: StudentSummary now includes
  `school_name` + `school_upi_id` (read from tenants on summary fetch).
- frontend dependency added: `qrcode-generator` (~5 kB min) + `@types/qrcode-generator` (dev).
- frontend/src/views/ParentPortal.tsx: PayModal renders a UPI QR (qrcode-generator
  createDataURL) + tappable `upi://pay?...` deep link; "Pay ₹X via UPI" button shows
  on the fee card when balance>0 AND school_upi_id is set; graceful "not set up" note otherwise.
- frontend/src/api/settings.ts + views/Settings.tsx (NEW): principal Settings tab to
  set the school UPI ID. Wired into app.tsx (View 'settings', VIEW_ACCESS principal-only,
  nav + render + icon).

Verification (live, real uvicorn + HTTP):
- principal PATCH /settings/upi valid → 200; invalid format → 422.
- accountant GET /settings → 200; PATCH → 403 (RBAC).
- parent summary (minted parent JWT) → returns school_name + school_upi_id.
- UPI deep link well-formed: upi://pay?pa=…&pn=…&am=…&cu=INR&tn=…
- qrcode-generator encodes the UPI string (33-module QR). Frontend tsc+build clean
  (39.68 kB gzip — QR lib added ~10 kB, well within <2 MB budget). Test data removed,
  daffodils upi_id reset to NULL.

Caveat: visual QR not browser-driven (no headless browser available); encoder verified
in node, data path verified over HTTP.

---

# Step 4a — Fee Setup Simplification (COMPLETED 2026-06-05)

Problem (user): fee system "too complex, does not load on adding fees"; wants
Excel to be the only way to set up fees.

Root cause: the fee schema/service was complete but the UI had 5 tabs with manual
"Add Fee Head" / "Add Schedule" forms AND a SEPARATE "Generate Ledger" tab.
Adding structure did nothing visible until you found the separate generate step,
so Outstanding stayed empty → "doesn't load on adding fees."

What was built:
- backend/services/finance.py: `_derive_month_year_pairs` (months spanned by the
  academic year's start..end) + `import_and_generate` — imports the structure
  Excel AND generates the per-student ledger for the whole year, in ONE explicit
  transaction. `/fees/import-excel` now calls this (auth: principal/accountant).
- frontend/src/views/FeesAdmin.tsx rewritten: removed all manual add forms and the
  Generate Ledger tab. Structure tab = upload .xlsx + read-only view of heads &
  schedules. Tabs now: Outstanding · Collect · Logs · Structure.

Verification (live, real uvicorn + HTTP):
- Upload (Fee Head|Fee Type|Class|Amount) → 1 head + 1 schedule + 360 ledger rows
  (30 students × 12 months) in one call. Direct DB count confirmed 360.
- Re-upload → 0 new ledger rows (idempotent, ON CONFLICT DO NOTHING).
- Backend import-clean; frontend tsc+build clean (29.92 kB gzip). Test data removed.

Note: import_and_generate reconciles the entire year's ledger on each upload
(harmless idempotent fill). The summary's "existing" count aggregates across all
schedules; UI only shows the accurate created/students_affected numbers.

---

# Step 2 — Attendance Edit + Roll Uniqueness (COMPLETED 2026-06-05)

Findings (spec was already partly satisfied, like Step 1):
- Roll-number uniqueness ALREADY enforced — migration 006 `unique_tenant_section_roll
  UNIQUE (tenant_id, academic_year_id, class_id, section_id, roll_number)` exists,
  live DB has zero duplicates, StudentForm already surfaces the 409. User confirmed
  per-SECTION scope is correct (sections of the same class may reuse roll numbers).
  → No change needed.
- Attendance "lock" was NOT in the service layer — `mark_attendance` already upserts
  (ON CONFLICT DO UPDATE). The lock was purely frontend.

What was built:
- backend/services/attendance.py: `mark_attendance` now emits ATTENDANCE_CORRECTED
  (vs ATTENDANCE_MARKED) when the edited session was already submitted — distinct
  audit signal for post-submit corrections.
- frontend/src/views/Attendance.tsx: added `editing` state + `locked` (= submitted
  && !editing). Submitted sessions show an "Edit / Correct" button that re-enables
  marking; controls and per-row marking gate on `locked` not `submitted`; Submit
  button reads "Save corrections" while editing.

Verification (live, real uvicorn + HTTP):
- open → mark P (ATTENDANCE_MARKED) → submit (200) → re-mark A (200) → record flips
  to A, emits ATTENDANCE_CORRECTED. Events for session: [ATTENDANCE_MARKED,
  ATTENDANCE_CORRECTED]. Frontend tsc+build clean (30.69 kB gzip). Test data cleaned up.

Note: ATTENDANCE_SESSION_SUBMITTED is in ARCHITECTURE.md's event catalog but
submit_session does not currently emit it — pre-existing gap, not introduced here.

---

# Step 1 — RBAC + Role Enforcement (COMPLETED 2026-06-05)

Discovered during implementation that the codebase was further along than the
roadmap assumed:
- `users.role` column already existed (002) — only needed a CHECK constraint + data migration.
- `staff_class_assignments` (007) already serves as both class-teacher and
  subject-teacher registry — the roadmap's proposed `class_teacher_assignments`
  and `subject_teachers` tables (migrations 018-table / 020) are REDUNDANT and
  were NOT created.
- JWT already carried `role`; middleware already set `request.state.user_role`.

What was actually built:
- Migration 018 (`018_rbac_roles.sql`): migrate legacy `admin` → `principal`,
  add `users_role_check` constraining role to the 6 staff roles. Reversible.
- Seed scripts updated `admin` → `principal` (seed_schools.py x2, seed_tenant.py).
- `backend/core/rbac.py`: `require_roles(*allowed)` coarse gate + `load_class_scope`
  / `assert_in_scope` fine gate for teacher class-scoping.
- Router guards wired into: students, staff, dashboard, fees, payments,
  attendance, homework, exam, timetable, cms_admin. (payments uses per-route
  guards because its webhook routes are JWT-exempt.)
- `core/csv_export.py`: EXPORT_ROLES modernized (dropped stale `admin`).
- Frontend `app.tsx`: `VIEW_ACCESS` map + `canSee()` gate nav tabs, landing
  view, and render per role. No login dropdown (role read from JWT).

Verification (live, against real uvicorn over socket):
- principal: students/fees/dashboard/exams all 200
- accountant: fees 200; students/exams/dashboard 403
- class_teacher: students/fees 403; timetable-read/exams-read 200
- class_teacher class scope: attendance own-class 200, other-class 403
- class_teacher timetable write: 403
- parent request-otp still 202, public school-info 200, no-token 401
- Migration: 5 `admin`→`principal`, invalid role rejected by CHECK.
- Frontend: tsc + vite build clean, 30.55 kB gzip. (Browser drive not performed —
  no driver available; gating is deterministic and mirrors the verified backend.)

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
## ADR-009 — RBAC via role column on users table (Approved — Sprint 2, shipped)
**Reason:** Simple column-level role with middleware propagation; no need for full permission table at MVP scale.
## ADR-010 — Event-bus worker via transactional outbox (Proposed — Sprint 3)
**Reason:** `audit_events` is producer-only; a single Postgres-polling worker over an outbox
turns recorded events into driven workflows without a broker (₹2k/month + single-codebase
constraints). Full write-up in ARCHITECTURE.md. **Trips approval gates** — see W1/W2.

---

# Known Issues

- (RESOLVED) Fee add form broken → replaced by Excel import (Step 4a)
- (RESOLVED) Roll numbers not unique → constraint already enforced (migration 006)
- (RESOLVED) Attendance locked after submit → edit-after-submit shipped (Step 2)
- (RESOLVED) Timetable teacher field → `timetable_slots.staff_id` exists (migration 013)
- Feature flags (`tenants.features` JSONB) mandated by CLAUDE.md but NOT built — see W4.
  (ROADMAP previously mislabelled migration 023 as this; 023 is the transport fee filter.)
- Domain events are recorded but not consumed (no worker) — the central Phase-2 gap (W1–W2).

---

# Blockers

- R2 credentials for production file uploads (blocks report-card PDF W13, admission docs W10)
- SMS/WhatsApp provider — paid service, needs approval + credentials (blocks W12)

---

# Pending Post-Launch

- SSL auto-renew cron: `certbot renew --quiet && docker compose -f ~/tulips/docker-compose.prod.yml exec nginx nginx -s reload`
- R2 env vars: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL
