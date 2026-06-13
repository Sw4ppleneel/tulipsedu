# Tulips.edu — Product Roadmap & Feature Plan
Last Updated: 2026-06-12

---

## ★ North Star — From CRUD Amalgamation to Workflow ERP

Phase 1 shipped every module on the access matrix. But each module is an island of forms
over its own tables: you create a student here, define fees there, mark attendance
elsewhere — and the system never connects them. A real ERP **drives the school's
processes**: one action ripples into the next without a human stitching modules together.

**What separates the two (and what we're missing):**

| CRUD amalgamation (today) | Workflow ERP (target) |
|---|---|
| Events written to `audit_events`, read by nothing | Events consumed by a worker that fires the next step |
| Flat records (paid / unpaid, submitted / not) | Lifecycle state machines (draft→open→locked→published) |
| Parents pull (log in to check) | System pushes (absent alert, fee reminder, result published) |
| Each module edited by hand, in isolation | Cross-module orchestration (approve admission → student + fees + parent access) |
| No time-based behaviour | Scheduler (overdue escalation, daily digests) |
| 202/async mandated but no worker exists | One Postgres-polling worker runs every async job |

**The three pillars we must add (none are new feature modules — they are connective tissue):**

1. **Event-bus worker (the spine)** — transactional outbox over `audit_events` + a single
   in-repo worker. Turns recorded events into actions. (ADR-010 in ARCHITECTURE.md.)
2. **Notifications + delivery** — a `notifications` table (in-app first, free), then an
   SMS/WhatsApp adapter. Makes the system *push*.
3. **Lifecycle state machines + orchestration** — explicit status on admissions, exam terms,
   fee installments; orchestrated transactions for admission approval and year rollover.

**Signature end-to-end workflows we're wiring** (current → target):

- **Attendance:** mark → *(absent)* parent alert → chronic-absence flag for class teacher.
- **Fees:** structure → ledger → due reminder → pay → receipt push → overdue escalation.
- **Exams:** configure term → enter marks → lock → **publish** → report-card PDF → parent notify.
- **Admissions (new):** enquiry → docs → **approve** → student + fee assignment + parent access.
- **Year rollover (new):** promote + close ledgers + archive + clone timetable, one txn.

The ordered, gated work item list is the **"Workflow ERP Transformation — FINAL TODO"**
at the top of BUILD.md (items W0–W14). Phases 1–3 below remain the longer-range feature
backlog those workflows draw from.

---

## Reference Systems Studied

### LAV_SMS (Laravel, single-tenant)
- 7 role types, clean middleware-per-role pattern
- Mark components as columns (t1, t2, t3, tca, exam) — we do this better with a components table
- PaymentRecord + Receipt: fee owed vs individual payment transactions with running balance
- Subject has a direct teacher_id — formal subject-teacher ownership
- No attendance, no notifications, no API — all gaps we fill

### Frappe Education (Python/Frappe, production ERP)
- **Two-level fee assignment:** Fee Structure (template per program/category) → Fee Schedule (batch, creates per-student records) → Fees doc (per student, per term)
- **Discounts per component:** each fee component has a discount % field
- **Installments:** multiple Fee Schedule entries per term, each with its own due_date
- **Guardian model:** Guardian doctype with `user` link gives parent portal access — noted for Phase 2 student portal only
- **Razorpay integration:** `get_payment_options()` creates order, client completes checkout, `handle_payment_success()` verifies signature, auto-creates Payment Entry
- **Student portal:** shows invoices (status, due date, outstanding amount), current enrollment, attendance
- **Email group sync:** guardian emails auto-added to class email group for bulk notifications

---

## The 7 Account Types

These are the 7 login roles for Phase 1. Librarian, Transport Manager, and Warden are out of scope until Phase 2+.

| # | Role | Scope | What they can do |
|---|---|---|---|
| 1 | **superadmin** | Platform | All schools, tenant management, platform analytics |
| 2 | **principal** | Own school | Full access — students, staff, fees, exams, reports, CMS |
| 3 | **vice_principal** | Own school | Same as principal minus staff management and CMS |
| 4 | **class_teacher** | Own class/section | Attendance, homework, student list for their class, marks for their subjects |
| 5 | **teacher** | Own subjects | Marks entry for assigned subjects, view timetable, view homework |
| 6 | **accountant** | Own school | Fee ledger, fee collection, receipts, defaulter reports |
| 7 | **parent** | Own children | Child's attendance, homework, fee balance, UPI QR payment |

**Parent auth is admission number only** — parent enters their child's admission number (`adm_no`), gets a JWT scoped to that student. No OTP, no password, no phone number. Admission number is permanent and printed on the student's ID card — it never changes. This is the only credential needed.

**Student portal** is Phase 2 (students get their own login to view marks, timetable, attendance, fee receipts).

**Access matrix:**

| Module | superadmin | principal | vice_principal | class_teacher | teacher | accountant | parent |
|---|---|---|---|---|---|---|---|
| Dashboard | ✓ | ✓ | ✓ | ✓ (own class) | ✗ | ✓ (fee summary) | ✗ |
| Students | ✓ | ✓ | ✓ | ✓ (own class) | ✗ | ✗ | ✗ |
| Staff | ✓ | ✓ | ✓ (view) | ✗ | ✗ | ✗ | ✗ |
| Attendance | ✓ | ✓ | ✓ | ✓ (own class) | ✓ (own class) | ✗ | ✓ (own child) |
| Fees | ✓ | ✓ | ✓ (view) | ✗ | ✗ | ✓ | ✓ (own child) |
| Homework | ✓ | ✓ | ✓ | ✓ (own class) | ✓ (own class) | ✗ | ✓ (own child) |
| Timetable | ✓ | ✓ | ✓ | ✓ (manage own) | ✓ (view) | ✗ | ✓ (own child) |
| Exams | ✓ | ✓ | ✓ | ✓ (marks for own subjects) | ✓ (marks for own subjects) | ✗ | ✓ (own child results) |
| CMS | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Superadmin | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

---

## Phase 1 — Sprint 2 (Current Sprint)

### 1. RBAC + App Shell Split

**Migration 018:**
```sql
ALTER TABLE users ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'principal'
  CHECK (role IN ('superadmin','principal','vice_principal','class_teacher','teacher','accountant','parent'));

CREATE TABLE class_teacher_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  staff_id UUID NOT NULL REFERENCES staff(id),
  class_id UUID NOT NULL REFERENCES classes(id),
  section_id UUID NOT NULL REFERENCES sections(id),
  academic_year_id UUID NOT NULL REFERENCES academic_years(id),
  UNIQUE (tenant_id, staff_id, class_id, section_id, academic_year_id)
);
```

**JWT payload** gains `role` field. Middleware propagates to `request.state.user_role`.

**Frontend:**
- Login page: role dropdown (Principal / Vice Principal / Teacher / Class Teacher / Accountant)
- After login, nav tabs gated by role from JWT
- Teacher/class_teacher: class selector pre-filtered to their assignment

**Backend:** Route-level guards — teacher can only query classes they're assigned to. Return 403 otherwise.

---

### 2. Bug Fixes

**Attendance edit after submit:**
- Remove submit-lock from service layer
- Add `PATCH /api/v1/attendance/records/{record_id}` with new status value
- Keep `submitted` boolean as "session reviewed" flag, not an edit lock

**Roll number uniqueness:**
- Verify constraint exists in production: `\d students` on the DB
- If missing: migration adds `UNIQUE (tenant_id, academic_year_id, class_id, section_id, roll_number)`
- Backend returns 409 with clear message on duplicate

**Timetable teacher field (Migration 019):**
```sql
ALTER TABLE timetable_slots ADD COLUMN staff_id UUID REFERENCES staff(id);
```
- Frontend slot form: teacher dropdown populated from staff list
- Grid cell shows teacher name abbreviation

---

### 3. Subject-Teacher Assignment

**Migration 020:**
```sql
CREATE TABLE subject_teachers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  class_id UUID NOT NULL REFERENCES classes(id),
  section_id UUID NOT NULL REFERENCES sections(id),
  academic_year_id UUID NOT NULL REFERENCES academic_years(id),
  subject VARCHAR(100) NOT NULL,
  staff_id UUID NOT NULL REFERENCES staff(id),
  UNIQUE (tenant_id, class_id, section_id, academic_year_id, subject)
);
```

This is the source of truth for "who teaches what." Marks entry, homework posting, and timetable slot teacher field all derive from this. Without it we can't enforce role-based data access for teachers.

---

### 4. Fee System Overhaul (Frappe-inspired, simplified)

**Frappe pattern adapted for our stack:**

Three-level model:
1. **fee_heads** — what fee types exist (Tuition, Transport, Exam) — already exists
2. **fee_schedules** — batch template: which fee heads, which amount, which classes, which month — already exists  
3. **fee_ledger** — per-student per-installment record (what is owed) — already exists
4. **fee_payments** — individual payment transactions against a ledger entry — already exists

**What's missing / broken:**
- Bulk ledger creation from fee_schedule (currently manual per student)
- Discount per ledger entry (Frappe has this — scholarship, sibling discount)
- Excel/CSV import to populate fee_ledger in bulk
- Clean UI that separates "define fee structure" from "collect fees"

**New upload endpoint:** `POST /api/v1/fees/import`
- Accepts CSV: `roll_number, fee_head, amount, due_date, installment_label, discount_amount`
- Idempotent: ON CONFLICT (tenant_id, student_id, fee_head_id, due_date) DO NOTHING
- Returns: imported count, skipped count, error rows

**Migration 021:**
```sql
ALTER TABLE fee_ledger ADD COLUMN discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE fee_ledger ADD COLUMN installment_label VARCHAR(50);  -- 'April', 'Q1', etc.
ALTER TABLE tenants ADD COLUMN upi_id VARCHAR(100);
```

**Fee UI redesign:**
- Tab 1 — **Structure:** Define fee heads and amounts per class (read-only after import, edit requires re-import)
- Tab 2 — **Ledger:** View all student fee records. Filter by class, month, status. Click row to collect payment.
- Tab 3 — **Collection:** Record cash/UPI/cheque payment. Print receipt. Accountant-only.
- Tab 4 — **Defaulters:** Overdue ledger entries grouped by class. Export CSV.

**Parent fee view:**
- Pending installments listed with due date and amount
- Tap any → modal shows UPI QR code
- QR deep link: `upi://pay?pa={upi_id}&pn={school_name}&am={amount}&cu=INR&tn=Fee+{label}`
- Client-side QR generation (qrcode.js, ~5 kB)
- Accountant manually marks paid after seeing the bank notification

---

### 5. Exam Mark Components (Frappe + CBSE inspired)

**CBSE standard per subject per term (total 100):**

| Component | Max Marks |
|---|---|
| Periodic Test (best 2 of 3 unit tests) | 10 |
| Notebook / Multiple Assessment | 5 |
| Subject Enrichment (Oral / Practical) | 5 |
| Theory Exam | 80 |
| **Total** | **100** |

Schools can configure their own breakdown. Our model is flexible — configured per exam term per subject.

**Migration 022:**
```sql
CREATE TABLE exam_term_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  exam_term_id UUID NOT NULL REFERENCES exam_terms(id),
  subject VARCHAR(100) NOT NULL,
  component_name VARCHAR(50) NOT NULL,   -- 'Periodic Test', 'Oral', 'Theory'
  max_marks INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, exam_term_id, subject, component_name)
);

CREATE TABLE exam_component_marks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  exam_term_id UUID NOT NULL REFERENCES exam_terms(id),
  student_id UUID NOT NULL REFERENCES students(id),
  subject VARCHAR(100) NOT NULL,
  component_name VARCHAR(50) NOT NULL,
  marks_obtained NUMERIC(5,1),
  entered_by UUID REFERENCES users(id),
  entered_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, exam_term_id, student_id, subject, component_name)
);
```

**Marks entry UI:**
- Select term → class/section → subject
- Table: one row per student, columns = components + auto-summed total + grade
- Save all in one call

**Result sheet:** component breakdown + total + grade + rank in class + teacher comment field

---

## Phase 2 — Next Quarter

### Student Portal
- Student gets login using their own admission number (same mechanism as parent portal)
- Views: own marks, timetable, attendance %, fee receipts (PDF download)
- Cannot modify anything
- One admission number = one portal, whether the parent or student is using it

### Admissions Module
- Public form on school website (CMS page with embedded form)
- Pipeline: Inquiry → Application → Documents → Approval → Fee Payment → Student Created
- Document upload via R2 presigned URLs (Aadhaar, birth certificate, TC, photo)
- Admission number auto-generated

### Communication Hub
- MSG91 for SMS: fee due reminder, absent alert, exam result published (no OTP — auth is admission number)
- In-app notifications table — polled by frontend, bell icon badge
- Broadcasts: principal sends to whole school / class / specific parents

### Report Cards (PDF)
- Template: school header, student photo, component-wise marks, attendance %, grade, position, teacher comment, principal signature placeholder
- Generated as PDF, stored on R2, parent downloads from portal
- `POST /api/v1/exams/terms/{id}/report-cards` → background job → 202 Accepted

### Staff Attendance
- Daily present/absent/late/on-leave per staff member
- Principal/VP can view; accountant uses for payroll (Phase 3)

### Fee Discounts & Scholarships
- Per-student discount on any fee component
- Categories: Merit, Sports, Need-Based, Sibling, Staff Ward
- Stored on fee_ledger.discount_amount (already in migration 021)

### Analytics Dashboard
- Fee recovery rate (collected / expected) per class and school-wide
- Attendance trend chart per class (last 30 days)
- Homework completion rate
- Low-attendance alert list (< 75%)
- Principal sees all; class teacher sees own class only

### Razorpay Integration
- Replace manual UPI QR with gateway
- Payment options: UPI, Debit Card, Net Banking
- `handle_payment_success()` auto-creates fee_payment record + marks ledger entry paid
- Zero MDR for UPI; ~2% for cards

---

## Phase 3 — Future

- Transport (routes, stops, student-vehicle mapping)
- Hostel (room allocation, warden logs, outpass)
- Library (issue, return, fine)
- HR / Payroll (staff salary, leave, performance)
- AI copilot for principal ("which students are at risk?")
- Predictive fee defaulter alerts

---

## Feature Flags

Column on tenants table: `features JSONB DEFAULT '{}'`

```json
{
  "attendance": true,
  "fees": true,
  "homework": true,
  "timetable": true,
  "exams": true,
  "parent_portal": true,
  "cms": true,
  "student_portal": false,
  "admissions": false,
  "transport": false,
  "hostel": false,
  "library": false,
  "razorpay": false
}
```

Each school can have different modules enabled. Frontend nav renders only enabled tabs. No separate deployment needed.

---

## Migration Index

| # | Name | Status |
|---|---|---|
| 001–011 | Foundation, Auth, Students, Staff, Attendance, Finance | Applied |
| 012–015 | Homework, Timetable, Exams | Applied |
| 016 | Parents + parent_students | Applied |
| 017 | CMS pages + announcements | Applied |
| 018 | RBAC: CHECK on users.role + admin→principal migration | **Applied 2026-06-05** |
| ~~018-table~~ | ~~class_teacher_assignments~~ | REDUNDANT — `staff_class_assignments` (007) already serves this |
| ~~019~~ | ~~timetable_slots.staff_id~~ | DONE inside migration 013 — `timetable_slots.staff_id` already exists |
| ~~020~~ | ~~subject_teachers~~ | REDUNDANT — `staff_class_assignments` with subject IS NOT NULL |
| 021 | tenants.upi_id (discount/installment_label deferred) | **Applied 2026-06-05** |
| 022 | exam_components + exam_component_marks | **Applied 2026-06-05** |
| 023 | **transport/hosteler fee filter** (students.is_transport + fee_schedules.student_filter) | **Applied 2026-06-07** |
| 024 | **worker spine** — worker_cursors + worker_dlq + notifications (+dedup idx) + fee_ledger.reminded_at | **Applied to dev 2026-06-13; prod pending** |
| ~~025~~ | ~~notifications table~~ | FOLDED INTO 024 (cursor+DLQ approach; audit_events stays immutable, no outbox columns) |
| ~~026~~ | ~~tenants.features JSONB~~ | REDUNDANT — `tenants.feature_flags` already exists (migration 001); `GET /me/features` allowlists module flags |
| 027 | exam_terms.status lifecycle | Planned — W8 |
| 028 | fee installment lifecycle status | Planned — W9 |
| 029 | admissions pipeline tables | Planned — W10 |
| 030 | academic-year rollover support | Planned — W11 |

---

## Architecture Rules (Non-Negotiable)

- Every table has `tenant_id`; every query is tenant-scoped
- Every state change emits an event (STUDENT_CREATED, FEE_COLLECTED, EXAM_PUBLISHED, etc.)
- No blocking I/O on request thread — SMS, PDF, email go to background worker, return 202 immediately
- No binary data through application server — files go direct to R2 via presigned URL
- Migrations versioned and reversible
- Multi-step operations in explicit transactions
- Feature flags control module availability per tenant
- Role checked at middleware AND at service layer (defence in depth)
