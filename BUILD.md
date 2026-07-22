# BUILD.md

## 🔧 BUILT 2026-07-21 — Multi-role staff support (migration 042, not yet deployed)

Owner requirement: one staff member holding more than one role at once (e.g.
accountant + teacher) — previously `users.role` was a single column, so
assigning a second role silently overwrote the first.

**Schema**: new `user_roles` join table (tenant_id, user_id, role), unique on
(tenant_id, user_id, role), backfilled from every existing `users.role` in the
same migration. `users.role` stays (NOT NULL satisfied) but is now a frozen
legacy snapshot — no new code reads it — kept rather than dropped so the
migration stays cheaply reversible (`down: DROP TABLE user_roles`).

**Backend**: JWT claim changed from singular `role` to `roles: list[str]`;
`request.state.user_role` → `request.state.user_roles` (frozenset) throughout
middleware/rbac/auth/csv-export/superadmin/parent/dashboard/students. `core/
rbac.py`'s `require_roles`/`load_class_scope` now do set-intersection instead
of equality — a user holding **any** unrestricted role (accountant, principal,
etc.) gets full class scope even if they also hold a scoped role like teacher
with zero actual assignments. `PUT /staff/:id/role` → `PUT /staff/:id/roles`
(`{roles: string[]}`, full-replace semantics, same as the old single-role
overwrite). `/auth/refresh` now re-queries current roles instead of trusting
the (possibly stale) refresh token's own claims — a pre-existing staleness bug
fixed as a side effect of touching this code (frontend doesn't actually call
refresh today, so this wasn't user-visible either way). Worker notification
fanout (`fees.py`, `admissions.py`) now joins `user_roles` with `DISTINCT` so
a user matching two roles in an `IN (...)` list doesn't get double-inserted
(already backstopped by the existing dedup index, but avoids the redundant
attempt). All 11 ops/seed scripts that write `users.role` directly (import
scripts, seed scripts, smoke tests) updated to also write the matching
`user_roles` row — the test fixture (`backend/tests/conftest.py`) included,
since without it every `require_roles`-gated test in the L1 predeploy-gate
suite would have silently 403'd.

**Frontend**: role switcher, not a merged portal — a multi-role user picks
one "active role" at a time (new dropdown in the portal header, only shown
when `roles.length > 1`); switching is a pure client-side state change (no
backend call, full role set already came down in the JWT) and re-renders the
selected role's existing, unchanged portal. This kept the diff small —
`Attendance.tsx`/`Dashboard.tsx`/`Exam.tsx`/`configs.tsx`'s per-role branching
logic didn't need to change at all, only `auth_state.ts`/`app.tsx` (roles
array + activeRole) and the new switcher itself. Staff role-assignment UI
(`Staff.tsx`) changed from a single `<select>` to a checkbox group.

**Tests**: new `backend/tests/test_multi_role.py` — assignment reflects
multiple roles, full-replace (not additive), JWT carries the whole set, the
combo-unrestricted-scope behavior, and the refresh staleness fix. New daily
integrity check `staff_user_missing_roles` in `audit_live_tenants.py` (and
therefore `test_invariants_live.py`) catches any future login created without
a matching `user_roles` row.

**Deploy-risk note**: no forced logout — the middleware falls back to the
legacy singular `role` claim if `roles` is absent, so tokens issued before
this deploy keep working until they expire naturally (60 min access-token
window), same as any other deploy.

**Not yet run**: `scripts/predeploy_gate.sh` / frontend typecheck / actual
deploy — next step before this can ship.

## ✅ DEPLOYED 2026-07-18 — Multiple class teachers per section + staff role visibility + parent-password rollout LIVE (migration 041)

Owner requests, three bundled:

**1. Multiple class teachers per section (migration 041).** The only blocker
was `sca_one_class_teacher_idx`, a partial unique index enforcing exactly one
`is_class_teacher=TRUE` row per (tenant, academic_year, class, section) —
dropped, replaced with a plain filtered index (`sca_class_teacher_idx`) for
lookup performance. No API/service logic assumed singularity elsewhere except
one exception-message branch in `create_assignment` (removed) and the daily
`audit_live_tenants.py` invariant `multi_class_teacher` (removed — multiple is
now a valid, intended state). Live-verified: 2 class teachers assigned to the
same section on a real tenant, rolled back, zero drift.

**2. Staff role wasn't visible anywhere in the UI (root cause of "principal
updating access did not immediately update on the page").** Not a
caching/refresh bug — `GET /staff` never returned `role` at all
(`StaffResponse` had no field for it, `list_staff`/`get_staff_member` never
joined `users`). The Staff list had nowhere to show a role change even after a
correct save, and the Manage Access modal's dropdown always defaulted to
`'teacher'` regardless of the member's actual current role — so it looked
broken but the underlying `PUT /staff/:id/role` call was working the whole
time. Fixed: `StaffResponse.role` (LEFT JOIN staff→users), a role pill in the
Staff list (desktop + mobile), and the modal now initializes to the member's
current role.

**3. Parent-portal password rollout (migration 039, deployed 2026-07-17) is
now LIVE for all 4 tenants** — `feature_flags.parent_password = true` set for
daffodilspublicschool, premchandmahtoic, premchandhighschool,
vivekmemorialhighschool (existing flags on premchandmahtoic preserved via
JSONB merge). Verified end-to-end on prod: `/public/school-info` returns
`parent_password: true`; login without a password now correctly 401s
`"Password required"`.
**Known impact, not a bug — needs follow-up:** DPS has **43** students with
placeholder parent-phone (`0000000000`) and PMIC has **3** — those families
cannot log into the parent portal until a teacher fills in a real number via
the teacher portal's **My Students** tool (built 2026-07-17). Premchand High
School and Vivek Memorial show 0 placeholder phones each, but both are a flat,
round 30 students — likely still seed/demo rosters rather than real imports
(never confirmed this session); worth checking before treating their "clean"
phone data as real. Also added: admins can now set a student's initial portal
password directly in the "Add Student" form (previously only settable after
creation, via edit-mode reset).

DB backed up before the flag flip: `tulipsedu-2026-07-18-1737.sql.gz`. Full
deploy (gate → migration 041 → rsync → build/health-check → smoke tests) all
green.

## ✅ RESOLVED 2026-07-18 — SSH-to-prod outage (root cause: Hostinger VPS Firewall default-deny)

Was blocked ~1 day (first noticed 2026-07-17 while trying to create Sudha
Tiwari's PMIC login). Root cause, found via console access (hPanel browser
terminal, since SSH itself was the thing blocked):

- `sshd`, `ufw`, and `iptables` on the box were all clean/healthy the entire
  time — never the cause. A full reboot didn't fix it either.
- Hostinger's **VPS Firewall** (a network-edge firewall separate from `ufw`,
  configurable in hPanel → VPS → Security → Firewall) had **zero rules**,
  which — confirmed by Hostinger support — means **drop all inbound
  traffic**, not pass-through. This explained every symptom: direct-IP 80/443
  timing out too (only Cloudflare-proxied HTTP worked), `tcpdump` on the box
  showing zero SYN packets arriving from any external client during live
  connection attempts (traffic never reached the VM's NIC at all), and it
  persisting across a reboot (nothing wrong with the VM itself).
- Fix: created firewall group `srv1729216-base` in hPanel with Accept rules
  for TCP 22/80/443 (source: Any), synced. Access returned within minutes.
- Note for later: this firewall must have been newly provisioned/enforced
  around 2026-07-17 — the box had working SSH-based deploys as recently as
  2026-07-16, so "zero rules" cannot have always meant deny-all on this
  account. Cause of the change itself (platform-side rollout vs
  abuse-triggered auto-provisioning) was never confirmed with Hostinger —
  worth asking if it recurs.

**Deploy of `origin/main` — DONE 2026-07-18**, see entry below. Both
remaining items from the outage are now also **DONE 2026-07-18**:
- **Sudha Tiwari's PMIC login created** — real number `7061530224`
  (her old staff row still held the duplicate `9334679531` from the
  original import, but had no `user_id`, so no collision). Checked for
  a phone collision first (none), then created via new
  `backend/scripts/create_staff_login.py <tenant_slug> <employee_no>
  <phone> <role>` (run for `premchandmahtoic` / `EMP011` /
  `7061530224` / `teacher`) — sets `staff.phone_number` +
  `staff.user_id`, password follows the standard convention. All 12
  PMIC staff now have working logins.
- **Umesh Yadav + Seema Toppo passwords reverted** to the standard
  convention (`phone[:4]@FirstName`) via
  `backend/scripts/revert_password.py <tenant_slug> <phone>
  <first_name>` (run for `premchandmahtoic` / `9334679531` / `Umesh`
  and `premchandmahtoic` / `7903181033` / `Seema`) — owner decided the
  2026-07-16 random rotation (see below) is no longer needed now that
  the leak is scrubbed from git history; repo is private and both will
  change their password on first login anyway via the self-service
  flow.

DB backed up (`backup_db.sh`) before each of the two writes above.

# Project Status

Project: Tulips.edu
Phase: Phase 2 — Workflow ERP (lifecycle state machines)
Current Sprint: Sprint 5 — W14 Analytics, W11 Rollover, W10 Admissions
Last Updated: 2026-07-13

---

# PROJECT STATE

Current Phase: Phase 2 Workflow ERP — lifecycle state machines in progress
Current Sprint: Sprint 5 — W14 Analytics (next), W11 Rollover, W10 Admissions, Exam module enhancements

## ✅ DEPLOYED 2026-07-18 — Parent-portal passwords + teacher roster tools + fee waive + sibling discounts (migrations 039–040)

Built + 20/20 service-level checks against the dev DB (rolled back, zero
drift); tsc + vite build clean. **Deploy held ~1 day on the SSH-to-prod
outage below** (Hostinger VPS Firewall — see resolution note at top of this
file); shipped the moment access returned, bundled with `c748334`
(password-revert script, unrelated) which had also landed on `main` during
the outage.

Verified live on prod post-deploy: gate passed (4 tests), DB backup taken
before migration (`tulipsedu-2026-07-18-0700.sql.gz`), `schema_migrations`
confirms 039 + 040 applied, `students.portal_password_hash` and
`student_fee_discounts` present in the live schema, all 4 containers healthy
post-reboot, `/health` → `ok`, full smoke suite green (backend 401-gating,
SPA, all 4 public school sites). No new dependency.

**1. Parent-portal password (migration 039, owner-directed).** Parent login was
admission number only — and admission numbers are sequential/guessable
(`DPS1-2026-001`…), so anyone could open any student's fees/attendance.
`students.portal_password_hash` added; login (`POST /parent/auth/login`) now
takes a password **when the tenant has `feature_flags.parent_password`**
(per-tenant staged rollout — OFF everywhere until flipped; other tenants
unaffected). Default password = **last 4 digits of `parent_phone`**, derived at
login while no hash is set (NOT persisted, so it tracks phone corrections);
placeholder-phone students (`0000000000`, 40 at DPS) can't log in until a real
number is set — "0000" is never accepted. Self-service change: parent-portal
header "Password" button → `PUT /parent/password` (requires current password,
min 4 chars). The public `GET /public/school-info` now returns
`parent_password` so the login UI knows to show the field + "first time? last
4 digits" hint.

**2. Teacher roster tools (no migration).** Teachers previously had zero student
access for edits. New **My Students** section in the teacher portal: pick
class/section → roster with inline **parent-phone edit** (validated Indian
mobile; "no phone" badge for placeholders) and **portal-password reset**. Backed
by `PATCH /students/:id/contact` + `PUT /students/:id/portal-password` —
teaching roles are `assert_in_scope`-checked against the student's
class/section; principal/VP unrestricted (principal also gets a reset control in
the student edit form). Rollout plan: teachers fill real phone numbers first,
then owner flips `parent_password` per tenant.

**3. Fee waive at Collect (no migration — 'waived' status + `waiver_reason`
existed since 010 but had no UI/API, so concessions were being marked *paid*,
inflating revenue).** Collect tab gains a **Waive…** button beside Collect:
mandatory reason, explicit "not counted as collected" warning.
`POST /fees/waive` (principal/accountant) guards like collection: only
pending/due/overdue rows, refuses rows attached to a live payment claim. Emits
**FEE_WAIVED**. Waived rows drop out of outstanding/defaulters/parent dues
without touching revenue figures.

**4. Sibling discounts (migration 040, `student_fee_discounts`).** Student edit
form (principal/VP) gains a **Sibling / Concession Discount** section: one
percentage + checkboxes for the fee heads it applies to (owner-specified UX).
`PUT /fees/discounts` replaces the student's discount set and, in the same
transaction, **recomputes unpaid ledger rows from the fee-schedule base
amount** — so edits never compound (50%→25% verified = 75% of base, not
37.5%); paid/waived rows and schedule-less arrears are never touched.
`generate_ledger` / `generate_ledger_for_new_student` apply the percentage at
insert, so re-imports and admissions-enrol honour discounts. Class-specific
schedule beats all-classes schedule (same precedence as generation). Emits
**STUDENT_DISCOUNT_SET**.

Events added: PARENT_PASSWORD_CHANGED (parent/staff variants), FEE_WAIVED,
STUDENT_DISCOUNT_SET — all audit-only, no worker consumer (unregistered events
are skipped safely). Verification script (rolled back, 20/20):
parent login flag-off/on, wrong/default/changed/reset password, placeholder
rejection, phone update, waive guards + re-waive block, discount
recompute/no-compound/restore/paid-untouched, event emission.

## 🔧 BUILT 2026-07-13 — PMIC public website photos curated from raw WhatsApp dump

`frontend/public/school-assets/premchandmahtoic/` had only `logo.png` plus 80
unsorted `WhatsApp Image ....jpeg` files (18MB, dumped there directly — would
have shipped in every frontend build). Reviewed all 80 via contact-sheet
thumbnails + full-res spot checks, then populated the convention `PremchandMahtoInterCollege.tsx`
expects: `hero.jpg`, `building.jpg`, `principal.jpg`, `gallery1-9.png`.

**Important catch:** PMIC and Premchand High School (a separate tenant,
`premchandhighschool`) share a physical campus, and roughly a third of the
raw dump was actually Premchand High School's Independence Day event and a
felicitation ceremony (confirmed via signage/banners in the shots) — not PMIC.
Those were excluded. Only photos with confirmed "PREMCHAND MAHTO INTER
COLLEGE" signage, or PMIC's pink-dupatta uniform, were used.

Raw source photos moved to `School_docs/Premchand Mahto Inter College/Website
Photos - raw/` (kept for reference, out of the frontend build).

Verified: dev server (`npm run dev`) confirmed all 13 asset URLs resolve
200, and filenames match exactly what `PremchandMahtoInterCollege.tsx`
references (no chromium/playwright available in this environment for a full
visual screenshot — recommend `/run-skill-generator` if that's needed
regularly).

**Open item:** `principal.jpg` is a solo desk portrait with PMIC admission
paperwork visible on the table (confirms correct school) but his role
(principal vs. admin staff) was not independently confirmed — worth a
sanity check with the school before treating it as authoritative.

## ✅ DEPLOYED 2026-07-16 — DPS: real fee structure imported + ledger generated

`DPS_Fee_Structure_Import.xlsx` was built 2026-07-07 but held back — one row
(Bus Fee) was marked "PENDING CONFIRMATION: assumed monthly" pending owner
sign-off. Owner confirmed 2026-07-16: Bus Fee is monthly, ₹700
(`student_filter=transport`, so only `is_transport=TRUE` students get it).
Also added a Pre-Nursery Tuition Fee row (₹700, same band as Nursery-U.KG)
since that class didn't exist when the file was first built (see Pre-Nursery
entry below). New `backend/scripts/import_dps_fee_structure.py` runs
`services.finance.import_and_generate` — the only supported way to set up
fees, imports the structure and generates the ledger atomically. Prod
backup: `tulipsedu-2026-07-16-1353.sql.gz`.

**Result:** 11 fee heads created, 12 updated (mock seed heads with matching
names, e.g. "Tuition Fee" — harmless upsert), 23 fee schedules created,
10,010 ledger entries created across all 401 active students. Full
structure: Admission Form/Fee, Development Fee (admission + annual),
Building Fee, Poor Fund, Smart Classes, Computer, Games/P.T, Report Card
(one-time/annual, all classes) + Tuition Fee (monthly, ₹700 Pre-Nursery
through Class 4, ₹800 Class 5-8) + Bus Fee (monthly, ₹700, transport
students only).

## 🔧 BUILT 2026-07-17 — Self-service password change + principal override

Owner request: give all teachers a way to set their own password, plus a
way for the principal to override any staff password from their console.

**Self-service (`PUT /auth/password`):** any authenticated staff role —
"Change Password" button added to the shared portal header (`PortalShell`),
so it's available regardless of role/portal without touching each
role's section list. Requires the current password (verified server-side),
new password minimum 6 characters.

**Principal override (`PUT /staff/:id/password`, principal-only):** added
a "Reset Password" section to the existing Manage Access modal on the
Staff page — only shown for staff who already have a login (`user_id` set).
No current-password check, since overriding without knowing the old one
is the entire point of an admin reset. If a staff member has no login yet,
principal uses Manage Access's role assignment first (already creates one).

Both paths emit `PASSWORD_CHANGED` (`by: "self" | "principal"`) for the
audit trail. New passwords are never logged or persisted anywhere except
the hashed `users.password_hash` column — self-service typed by the owner
of the account, principal-override typed directly into the principal's
own console, matching this session's "generate server-side / never in a
command line" discipline from the earlier password-leak cleanup.

## ✅ DEPLOYED 2026-07-17 — PhonePe security-blocked the tap-to-pay link; added QR fallback hint

Live report: PhonePe rejected tapping "Open UPI app" with a security
message ("use UPI ID, QR code, or mobile number"). Confirmed via
follow-up: only the tap link, not the QR scan (which works, per the
encoding fix above).

**Why:** likely 2026 UPI ecosystem security tightening, not a Tulips.edu
bug per se. NPCI deprecated manual UPI-ID/mobile-number entry ("UPI
Collect") from 28 Feb 2026, and UPI 2.0 pushes signed intents — apps are
increasingly wary of unsigned `upi://` deep links tapped directly from a
web page (no way to verify the initiating site is legitimate; this
pattern is a known phishing vector), versus a QR scan, which requires a
deliberate physical action and apparently goes through different/more
trusting validation on PhonePe. Tulips.edu's link is unsigned (built
client-side, not through a registered PSP) — this is the same gap a real
payment gateway (Razorpay/PhonePe PG, discussed with the owner
2026-07-16) would close, since gateway-issued intents are cryptographically
signed and recognized as legitimate merchant transactions.

**No real fix available without a payment gateway.** Added a small hint
under the "Open UPI app" button: "If your app blocks this for security
reasons, scan the QR code above instead." Left the button in place since
this looks PhonePe-specific — no evidence GPay/Paytm/BHIM have the same
issue. Frontend-only deploy, smoke tests passed.

## ✅ DEPLOYED 2026-07-17 — Fix: UPI QR scan didn't fill payee name/note (tap did)

Live report: tapping "Open UPI app" correctly showed the student's name +
admission number in the UPI app, but scanning the same QR with a UPI
app's camera only brought through the amount.

**Root cause:** `upiUri()` (`ParentPortal.tsx`) built the query string with
`URLSearchParams`, which serializes as `application/x-www-form-urlencoded`
— spaces become `+`. The UPI QR spec calls for RFC 3986 percent-encoding
(`%20`). The OS's own `upi://` intent handler tolerates `+`-as-space
(tap worked), but a UPI app's own QR-scan parser reads the raw QR text
more strictly — literal `+` in the payee name/note looks malformed and
gets silently dropped, while `am` (no spaces) was unaffected either way.
Verified: `URLSearchParams({tn: note})` → `Daffodils+Public+School+%7C+...`
vs `encodeURIComponent(note)` → `Daffodils%20Public%20School%20%7C%20...`.

**Fix:** build the query string manually with `encodeURIComponent`
instead of `URLSearchParams`. Same `uri` backs both the QR and the tap
link, so one change fixes both. Frontend-only deploy, smoke tests passed.

**Follow-up (not a bug, no further fix needed):** owner reported PhonePe
still shows no note/message after the fix. Confirmed the payee name (school
name) now displays correctly on PhonePe scan (proof the encoding fix
worked) — but the `tn` note (which carries student name + admission
number) still doesn't show. Per current docs, this looks like a PhonePe/
Google Pay product limitation, not an encoding issue: **Paytm is the only
major UPI app that prominently surfaces `tn` on its scan confirmation
screen; PhonePe and GPay generally don't display it at all**, regardless
of encoding correctness. Doesn't affect actual reconciliation — the
accountant verifies payments via the parent's in-app "I've paid" claim
(tied to their logged-in student/fee/amount), not by reading PhonePe's
screen; the note was only ever a courtesy for the parent. Offered folding
the admission number into the payee-name field instead (the one field
that reliably displays everywhere) as a workaround — owner declined,
kept payee name as just the school name.

## 🔧 BUILT 2026-07-17 — Name-based search for offline fee collection

Owner request: accountant could only find a student by exact admission
number in the Collect Fee tab; add name search too, showing profile cards.

**Implementation:** `CollectTab` (`FeesAdmin.tsx`) now loads the full
roster once on mount (`listStudents({limit: 5000})`) and filters
client-side as the accountant types — matches on admission number OR
`first_name + last_name` substring, case-insensitive, capped at 25 results
rendered as clickable cards (name, class/section, roll number, phone,
admission number). Clicking a card loads that student's ledger exactly
like the old exact-match flow; a "← Search again" link resets back to
search mode. Also bumped `GET /students`' limit ceiling 500 → 5000
(`api/v1/students.py`) to match the platform's stated max tenant size —
same silent-truncation class of bug as the Outstanding Dues fix, caught
this time before it shipped as a visible bug.

**Not click-tested in a browser** — no chromium-cli/playwright available
in this environment (same limitation noted for the PMIC photo work
earlier). Verified via typecheck + backend syntax check + code review;
owner is the one actually testing live via the Daffodils pilot, so this
will get real usage quickly.

## ✅ 2026-07-16 — Scrubbed 2 leaked passwords from git history + rotated both

Owner asked to remove the leaked-password commit info. Auditing found the
leak was worse than known: **two** real credentials had been committed in
plaintext, not one —
1. Umesh Yadav's (PMIC Principal) password in a BUILD.md commit (already
   flagged earlier this session).
2. Seema Toppo's (PMIC teacher) password, used as a real "e.g." example in
   `import_pmic_teachers.py`'s docstring — this one was **still live in
   HEAD**, not just history. Fixed the docstring to use a fake example
   (fake phone/name) first.

**Rotated both** (owner confirmed via `AskUserQuestion` for each) before
touching history — the actual fix, since a scrubbed-but-not-rotated
password is still valid if anyone already has a copy. New random 14-char
passwords generated server-side inside `rotate_password.py` (never a CLI
arg or env var — both would recreate the same class of leak via shell
history/process listings). New passwords relayed to the owner directly in
chat, not committed anywhere.

**History rewrite:** installed `git-filter-repo` (brew), tagged a backup
of pre-rewrite `main` on origin first, mirror-cloned locally (network
clone of the GitHub repo timed out — cloned from the local working copy
instead, same history), ran `--replace-text` against both leaked strings,
force-pushed the rewritten `main` to origin. Confirmed `dev`/`prod` were
both frozen at a much older commit (`2424448`, predating all of today's
work) and never contained either string, so only `main` needed touching.
Verified `origin/main` clean post-rewrite (`git log origin/main -p |
grep` for both strings → 0 matches), then hard-reset the local working
copy to match. Deleted the backup tag afterward (owner confirmed) — an
unrotated backup pointing at the old history would have defeated the
whole scrub.

## ✅ DEPLOYED 2026-07-16 — Fix: accountant 403'd collecting fees ("insufficient permission")

Live bug report: accountant denied collecting a fee for a student.
Backend logs showed `GET /students?limit=500 → 403` right before the
report — `FeesAdmin`'s Collect tab loads the roster via that endpoint to
pick a student, but `GET /students` only allowed
principal/vice_principal/class_teacher/teacher, not accountant, despite
accountant being explicitly allowed to *collect* fees.

**Fix:** added `accountant` to that endpoint's allowed roles
(`api/v1/students.py`), and to `UNRESTRICTED_ROLES` (`core/rbac.py`) —
without the second part, the scope-checking middleware (`load_class_scope`)
would've treated accountant as a per-class teaching role (empty scope,
since accountants have no class assignments), swapping the 403 for a 400
demanding a `class_id`/`section_id` the Collect tab never sends. Accountant
is correctly tenant-wide, same as principal/vice_principal, not scoped to
one class. Full deploy, gate passed, no pending migrations.

## ✅ DEPLOYED 2026-07-16 — Fix: 500 on GET /staff/assignments (class assignments list)

Live bug report from the owner's first real click-through test: assigned
Amrita Kumari (DPS) as class teacher for Pre-Nursery-A, then hit "Internal
Server Error" navigating to the principal's Assignments page to remove it.
Backend logs (`docker logs tulips-backend-1`) showed
`KeyError: 'first_name'` in `list_all_assignments`
(`services/staff.py`) — pre-existing bug, not introduced this session, just
never exercised until now.

**Root cause:** `list_all_assignments` joins the `staff` table to build
`staff_name`/`designation` for the principal panel, but the shared
`_ASSIGNMENT_JOIN` SELECT only covers
`staff_class_assignments`/`classes`/`sections`/`academic_years` — it never
selected `staff.first_name`/`last_name`/`designation`, so every call to
`GET /staff/assignments` raised a 500 before a principal could view (let
alone remove) any class-teacher assignment.

**Fix:** gave `list_all_assignments` its own query selecting the staff
columns it actually needs, instead of reusing the shared join (which is
still correct for `list_assignments`, the single-staff variant that
doesn't join `staff`). Verified the exact failing query directly against
prod post-deploy — returns Amrita Kumari's Pre-Nursery-A assignment
correctly. No errors in backend logs since deploy. Full deploy, gate
passed, no pending migrations.

## ✅ DEPLOYED 2026-07-16 — Fix: Outstanding Dues total didn't match Dashboard total

`get_outstanding_dues` (`services/finance.py`) summed `grand_total`/
`student_count` from the already-`LIMIT`/`OFFSET`-paginated `items` list —
so it only reflected the current page (default 200), not everyone with
dues. `Dashboard`'s `fee_outstanding` sums the whole tenant unpaginated, so
the two figures silently diverged once a tenant had more students with
dues than the page size. Exactly DPS's situation right now: 401 active
students, all freshly ledgered (10,010 entries from the fee-structure
import above) → 401 students with dues, only the first 200 counted toward
the old grand_total.

**Fix:** `grand_total`/`student_count` now come from a separate
unpaginated `SUM`/`COUNT(DISTINCT student_id)` query using the same
filters — verified directly against DPS: 401 students with dues,
₹55,91,200 total, matching the Dashboard figure exactly. Also fixed a
related gap: the Outstanding Dues report page has no pagination UI at all
(no "next page" control), so the visible row list was silently truncated
at 200 too. Raised the endpoint's limit ceiling (200/500 → 500/5000,
matching the platform's stated 5,000-student tenant ceiling) and the
frontend now explicitly requests the full ceiling so the row list matches
what the total counts. Full deploy (backend + frontend), gate passed
(4 tests, "not live" suite), no pending migrations.

## ✅ DEPLOYED 2026-07-16 — Parent portal: monthly fee items individually selectable

Follow-up to the itemization fix above — owner: "make the items selectable
individually per month." Each fee head in a monthly card now has its own
checkbox (all checked by default, so the default action still pays the
whole month); total and button label track the current selection. Mirrors
the existing one-time-fees checkbox pattern. Deployed via
`scripts/deploy.sh --frontend-only`.

## ✅ DEPLOYED 2026-07-16 — Parent portal: itemize monthly fee heads separately

Monthly ledger dues (e.g. DPS's Tuition Fee + Bus Fee for transport
students) were grouped by month into one card with all fee-head names
joined into a single " · " subtitle and one combined amount — parents
couldn't see what each head cost. This is shared code (`ParentPortal.tsx`
`FeesSection`), affects every tenant with more than one monthly fee head,
not just DPS. Confirmed scope with owner via `AskUserQuestion`: keep one
card per month / one combined "Pay via UPI" transaction, but itemize each
fee head as its own labeled line with its own amount inside the card
(running total below), rather than splitting into separate payable cards
per fee head. Deployed via `scripts/deploy.sh --frontend-only`.

## ✅ DEPLOYED 2026-07-16 — DPS: filled in 2 remaining staff phone numbers

Indu Kumari (EMP021, Accountant) and Mamta Kumari (EMP020, Office Incharge)
were 2 of the 8 support staff imported with `PLACEHOLDER_PHONE` and no
login. Owner supplied both real numbers directly. Indu Kumari's role
(Accountant) maps to `VALID_ROLES`, so she also got a login
(`backend/scripts/update_dps_staff_phones.py`, same convention as
everyone else). Mamta Kumari's role (Office Incharge) has no `VALID_ROLES`
mapping — phone updated only, no login, consistent with the original
import logic. `STAFF INFO.xlsx` updated too. Prod backup:
`tulipsedu-2026-07-16-1425.sql.gz`. Remaining without phones: Ramesh
Mahto, Manoj Mahli, Vivek Kumar (drivers), Rudan Devi, Laxmi Devi (peons),
Raj Kumar (guard) — none have a `VALID_ROLES` mapping anyway, so no login
gap even once their numbers arrive, just contact info.

## ✅ DEPLOYED 2026-07-16 — DPS: real staff roster (27, incl. support staff)

Owner first supplied an 18-teacher contact directory directly in chat (name
+ phone only). Imported that as EMP001-EMP018 with placeholder
designation="Teacher"/role=teacher. **Then discovered** (owner prompted:
"make sure the excel is populated, it already contains the designations")
that `School_docs/Daffodils/STAFF INFO.xlsx` already existed with real
designation/department/date of joining/date of birth/role for **27** staff
— the 18 teachers plus 9 more (Dr. Prabha Rani as Principal, and 8 support
staff: office incharge, 3 drivers, 2 peons, 1 guard) — just missing phone
numbers. Should have used this file from the start instead of the chat
list; corrected course once found.

**Merge + reimport:** populated STAFF INFO.xlsx's blank PHONE NO column by
matching names against the original 18-teacher chat list (19/27 matched,
including one non-obvious match: "Deepak Sir (Shivshanker)" from the chat
list = "Shiv Shankar Mahto" / P.T. Teacher in the xlsx — same person, chat
list used his nickname) plus Dr. Prabha Rani's number, reused from her PMIC
import (owner confirmed same person across both schools). Rewrote
`reset_and_import_dps_teachers.py` to read from the xlsx; owner confirmed
via `AskUserQuestion` to wipe the interim 18 (with working logins) and
reimport all 27 fresh rather than partially merging. Prod backup:
`tulipsedu-2026-07-16-1415.sql.gz`.

**Result:** created=27 (EMP001-EMP027), 19 with logins (real phone + role
mappable to `VALID_ROLES`), 8 without (support staff have no phone in
either source — `phone_number` is `NOT NULL` on `staff`, so they get
`PLACEHOLDER_PHONE="0000000000"` and no `users` row; not guessed/fabricated
contact info, just a required-column placeholder, correctable via
dashboard once the owner has their numbers). Missing DOJ (8 rows, mostly
teachers added later without a recorded join date) → placeholder = script
run date; missing DOB left `NULL` (nullable column, no placeholder needed).
Login convention same as PMIC (username=phone, password=first 4
digits+@+first name).

## 🔧 BUILT 2026-07-16 — PMIC public website: re-curated photos + principal name

Owner rejected the first photo curation pass (2026-07-13) and manually
selected/renamed 10 replacement files in `Website Photos - raw/` (hero +
9 semantically-named event/facility photos: classroom, event1, independence,
lab, mentalhealth, picnic, planting, sports, teachersday). Applied:

- `hero.jpg` and `gallery1.png`-`gallery9.png` replaced from the owner's
  10 renamed files.
- `principal.jpg` deleted (owner: "keep principal empty") — `SchoolImage`
  falls back to its placeholder automatically, no code change needed.
- Gallery captions in `PremchandMahtoInterCollege.tsx` rewritten to match
  actual photo content (old captions were generic/mismatched placeholders
  from the first pass — e.g. "Republic Day Celebration" when the photo is
  actually Independence Day).
- Principal section: `[Principal's Name]` placeholder (was never filled in)
  replaced with "Umesh Yadav".
- `building.jpg` left unchanged — none of the 10 renamed files were a
  building replacement; not addressed by the owner's instructions.

**Resolved 2026-07-16:** owner confirmed 9334679531 (the number that
appeared duplicated against Sudha Tiwari's row) is in fact Umesh Yadav's
correct number — Sudha's own row is the one that's wrong, still excluded
pending her real number. Added `+91 93346 79531` next to his name in the
Principal's Message section. Deployed via `scripts/deploy.sh --frontend-only`.

**Known issue found this deploy — Cloudflare edge cache staleness (root
cause of "hasnt loaded on prod yet" from the 2026-07-13 pass too, most
likely):** `nginx.prod.conf`'s `location ~* \.(js|css|woff2?|png|jpg|jpeg|
svg|ico|webp)$` block sets `Cache-Control: public, immutable` + `expires 1y`
on *all* image files. That rule is meant for Vite's content-hashed build
output, but it also matches `/school-assets/<slug>/*` — which reuses stable
filenames (`hero.jpg`, `gallery1.png`, ...) across curation passes. Result:
Cloudflare's edge served the 2026-07-13 photos (confirmed via
`cf-cache-status: HIT` + matching old `content-length`) for ~15 minutes
after this deploy, even though origin nginx had the new files. Owner is
purging the Cloudflare cache manually via dashboard as the immediate fix.
**Not yet fixed at the root** — recommend excluding `/school-assets/` from
the immutable-cache location block (short TTL + revalidation instead) so
future photo re-curations don't need a manual purge. Needs owner sign-off
since it's an `nginx.prod.conf` change (deployment topology gate).

## ✅ DEPLOYED 2026-07-16 — PMIC: real teacher roster imported (9 of 13)

Source: government UDISE Teacher Profile export
(`School_Teacher_Profile_Details.numbers`, exported to `.xlsx` via Numbers —
`numbers_parser` isn't installed, used the Numbers.app GUI export instead of
adding a new pip dependency). New one-off script
`backend/scripts/import_pmic_teachers.py`, same `docker cp` + `docker exec`
pattern as the DPS scripts (prod DB backed up first:
`tulipsedu-2026-07-16-0653.sql.gz`).

**Login convention (owner-specified, PMIC-specific):** username = phone
number, password = first four digits of the phone number + `@` + first name
(Title Case). Actual passwords are derivable from this rule + each
person's phone/name — **never write real passwords into this file**; the
script's stdout (not persisted) is the place to read them at import time.

**Imported (10 of 13, EMP001-EMP010):** EMP001-EMP009 `role=teacher`/
designation `Lecturer`; EMP010 Umesh Yadav — `role=principal`, added
2026-07-16 after the owner confirmed his number (see re-run note below).

**Idempotency fix (2026-07-16):** the first version of this script derived
`employee_no` from `existing_staff_count + list_position`, which would have
reassigned all 9 already-imported teachers to new employee numbers on
re-run — inserting 9 duplicate staff rows instead of updating them (staff's
unique constraint is `(tenant_id, employee_no)`, not phone). Fixed to look
up `employee_no` by `phone_number` for already-imported teachers before
assigning new numbers; re-run correctly showed `created=1, updated=9`.

**Resolved 2026-07-16 (owner directives, second re-run — created=2,
updated=10, errors=0, EMP001-EMP012):**
- **Shashi Kant Kumar** — has left the school. Permanently excluded (not
  "pending" anymore).
- **Dr. Prabha Rani (EMP012)** — imported with placeholder
  designation="Teacher"/role=teacher and date_of_joining=2026-07-16 (script
  run date) per owner's approval; she'll set the real designation from the
  dashboard. Login works (phone 8789607250, password per the convention
  above). Name-parsing
  fix needed here too: "Dr. Prabha Rani" was splitting first_name="Dr" —
  `title_case_name()` now strips known title prefixes (Dr/Mr/Mrs/Ms) first.
- **Sudha Tiwari (EMP011)** — owner: use her spreadsheet number
  (9334679531) as-is despite the collision with Umesh Yadav's. Since
  `users` is unique on `(tenant_id, phone_number)`, literally creating her
  login would have silently overwritten Umesh's password/role. Added a
  generic collision guard instead: her `staff` row was created (phone
  field set as given) but **no login** — `has_login=false`. She can't sign
  in until the owner supplies her real number and the script is re-run.
  Also switched employee_no idempotency from phone-keyed to name-keyed for
  this reason — the old phone-keyed lookup would have resolved her to
  Umesh's existing employee_no (EMP010) and overwritten his whole staff
  row, not just failed to create a login.

`import_pmic_teachers.py` is additive/idempotent (upsert keyed on
first+last name), safe to re-run whenever Sudha's real number arrives.

## ✅ DEPLOYED 2026-07-07 — Daffodils Public School (DPS): real roster replaces mock seed data

Ran `backend/scripts/reset_and_import_dps.py` directly against prod (one-off, not
wired into an API — mirrors the `import_pmic_science_commerce.py` pattern).

**What it did, in one transaction:**
1. Deleted the 30 mock/seed students and 5 mock "Grade 6-10" classes on
   `daffodilspublicschool` (and all dependent rows: fee_ledger, fee_payments,
   fee_payment_items, mark_entries, attendance_sessions, exam_subjects,
   homework_posts, staff_class_assignments, timetable_slots).
2. Archived the stale `2025-2026` academic year (had already ended, rollover
   never ran) and created `2026-2027` (2026-04-01 → 2027-03-31) as current.
3. Created the real class structure: Nursery, K.G. I, K.G. II, Class 1-8
   (single section "A" each, matching the source roster).
4. Imported 352 real students from `School_docs/Daffodils/STUDENTS INFO. $.xlsx`
   via `services.student.import_students` (created=352, errors=0).

**Admission-number convention** (tenant-specific, not a global rule):
`DPS{N}-2026-{roll:03d}` for Class 1-8, `DPSK1-`/`DPSK2-` for K.G. I/II,
`DPSN-` for Nursery. Year token is the new academic year's start year.

**Pre-Nursery added (2026-07-16):** source file has a "PRE. NUR" class (30
students) that predates Nursery in the school's actual ladder and wasn't in
the original `CLASS_DEFS`. Added via new
`backend/scripts/import_dps_prenursery.py` — created the class/section shell
(`numeric_order=0`, sorts before Nursery) and imported the roster (same
`docker cp`/`docker exec` pattern, prod backup
`tulipsedu-2026-07-16-0701.sql.gz`). One row (roll 30, RICHA MAHTO) had
shifted source columns (gender cell held a date, DOB was empty, phone was
9 digits) — handled with the same placeholder conventions as the original
import (unrecognised gender -> Other, missing DOB -> 2000-01-01, short
phone -> 0000000000), not a new judgment call. Result: created=30, errors=0.
DPS now has 401 students across 12 classes (Pre-Nursery-Class 8).
Admission numbers `DPSPN-2026-{roll:03d}`.

**Known gap (resolved 2026-07-16):** Class 6 originally had zero students —
the source file's 19 Class-6 rows were placeholder roll numbers only. Owner
supplied the real roster in the same source file; imported via new
`backend/scripts/import_dps_class6.py` (additive, upserts on admission
number into the existing tenant + current academic year — no reset). Ran the
same `docker cp` script + xlsx into `tulips-backend-1` / `docker exec` pattern
as the original import, after taking a prod DB backup
(`tulipsedu-2026-07-16-0635.sql.gz`). Result: created=19, updated=0, errors=0.
DPS now has 371 students across all 11 classes (was 352). Admission numbers
`DPS6-2026-{roll:03d}`.

**Data-quality notes for future re-imports of this source file:** DOB strings
had typos (letter "O" for zero, stray spaces/doubled separators) — handled by
a general cleaner in the script; one row (K.G.II roll 16) needed a hardcoded
override for an unrecoverable truncated year. 40/352 rows had no DOB
(placeholder `2000-01-01`) and 40/352 had no phone (placeholder
`0000000000`), matching the PMIC import convention.

## 🔧 BUILT 2026-06-26 — Exam: subject management UI + marks validation

**Manage Subjects tab** (principal/VP only) added to ExamView:
- New tab between "Manage Terms" and "Marks Entry"
- Class picker + subject name/code form → `POST /exams/subjects`
- Lists existing subjects per class
- `createSubject()` API function added to `frontend/src/api/exam.ts`

**Marks > max validation — both layers:**
- Frontend: `handleSaveFlat` checks each mark ≤ `selectedConfig.max_marks` before submit; error message names the student
- Frontend: `handleSaveComponents` checks each component mark ≤ `component.max_marks` before submit
- Backend `save_marks`: fetches `exam_marks_config.max_marks` per subject and raises `ExamError` on violation (409)
- Backend `save_component_marks`: fetches `exam_components.max_marks` per component and raises `ExamError` (409)

**ARCHITECTURE.md**: Exam API catalog updated with 7 missing endpoints (components, term status, report-card PDFs, import); parent portal section adds admission-number login + report-card PDF.

NOT YET DEPLOYED.

## 🔧 BUILT 2026-06-23 — Exam: simple terms + component weightage (migration 036)

**Migration 036**: relaxes `exam_terms.term_type` CHECK to include `'term'` (generic);
adds `exam_components.weightage NUMERIC(5,2) NOT NULL DEFAULT 100 CHECK (>0)`;
backfills `weightage = max_marks` so existing results are numerically preserved.

**Backend changes**:
- `configure_components` accepts `weightage` per component; mirrors `max_marks=100` into
  `exam_marks_config` (subject total is now scored /100).
- `save_component_marks` roll-up uses weighted formula:
  `ROUND(SUM(marks/max*weightage) / SUM(weightage) * 100, 2)` into `mark_entries`.
- `get_component_marks_grid` computes weighted total /100 client-side-ready.
- `_VALID_TERM_TYPES` includes `'term'`; `ExamTermCreate.term_type` defaults to `'term'`.
- `ExamComponentCreate`/`Response` gain `weightage` field.

**Frontend changes**:
- Manage Terms tab: "+ Add Term" button creates `Term {N+1}` (generic `term` type).
  Removed TYPE column (no longer relevant for generic terms).
- Component editor: new Weightage column per component; shows total weightage sum.
- Marks grid: Total column shows `/100` (weighted percentage); live client-side calc matches backend.
- `exam.ts`: `createTerm()` API function; `ExamComponent` type gains `weightage`.

**Seed script**: terms renamed from "Unit Test 1 / Half Yearly / ..." to "Term 1/2/3"
with `term_type='term'`, max_marks=100 for marks config.

NOT YET DEPLOYED. Deploy will auto-apply migration 036 via entrypoint.

## ✅ DEPLOYED 2026-06-18 — admissions public form polish + document upload (migration 034)

1. **W13 report-card PDF — now DEPLOYED.** The previously-built-but-undeployed staff +
   parent report-card PDF endpoints are live (was 404, now 401 auth-gated). reportlab already
   on the image; no migration. Code + frontend only.
2. **Public admission form reworked → collapsible dropdown.** The inline form was too heavy
   on the page; it now sits collapsed behind an "Apply Online — Start Admission Enquiry"
   button and drops down via a max-height CSS transition (no animation lib). All 3 school sites.
3. **Admission document upload (migration 034, PC Inter College only).** Decided model:
   *upload-after-submit, token-gated* (safest). Flow: applicant submits enquiry → backend
   returns a 30-min HMAC token scoped to that admission → browser uploads each file directly
   to R2 via a presigned PUT → confirm endpoint HEAD-checks (≤5 MB, PDF/JPG/PNG, else
   delete+413) and appends {name,url,key} to the new `admissions.documents` JSONB. Public
   upload endpoints are JWT-exempt and verify the token themselves; gated per-tenant by
   `feature_flags.admission_docs` (set TRUE for `premchandmahtoic` only). Docs collected:
   Class 10 (Matric) Marksheet*, Transfer Certificate*, Caste/Category Certificate. Other
   schools collect docs internally (no upload UI).
   - Event: **ADMISSION_DOCUMENT_UPLOADED** (registered in worker, no consumer yet).
   - Endpoints: `POST /admissions/documents/upload-url`, `POST /admissions/documents/confirm`;
     `POST /admissions/enquiry` now returns `upload_token` for docs-enabled tenants.
   - New `core/r2.py` shared R2 client (uploads.py left untouched).
4. **Bug fix (latent, surfaced by #3): JSONB `feature_flags` decoded as a string.** No JSONB
   codec on the asyncpg pool, so `request.state.feature_flags` was the raw JSON string; it
   only ever worked because the column was always NULL (`None or {}` → dict). Populating it
   broke `.get()` (and would have broken `/me/features` + the live payments flag path). Fixed
   at the single chokepoint — the tenant middleware now `json.loads` the JSONB string once.
   JSONB *writes* are untouched (still pass JSON strings).

**UI fixes (frontend-only, deployed 2026-06-18):**
- Circular logo crop for Premchand Mahto IC + Premchand High School — the square logo was
  leaking past the rounded chip; chip is now a circle with `overflow:hidden` and the image is
  cropped to the circle (`objectFit:cover`, `border-radius:50%`). Daffodils unchanged.
- App-wide horizontal-scroll fix: `html,body{overflow-x:clip;max-width:100%}` in globals.css.
  Used `clip` (not `hidden`) so it doesn't create a scroll container — `position:sticky`
  (PortalShell + ParentPortal headers) and the public sites' `position:fixed` navs still work.

Verified on prod: migration 034 recorded + `documents` column present; flag TRUE only for
premchandmahtoic; gating matrix (enquiry token only for docs school; upload-url 403 off-feature
/ 401 bad-token / 415 bad-type / 200 valid); full E2E (enquiry→presigned PUT→confirm→documents
JSONB) round-trip with a dummy PDF, then test object + 5 test rows deleted. `/me/features`
returns 401 (not 500) confirming the flag-parse fix. Doc-upload UI ("Supporting Documents") in
the live bundle; all containers healthy.

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
- R2 upload endpoint (live — presigned URL flow, teacher media uploads wired)

Completed this session: **W9** (fee lifecycle) · **W14** (analytics) · **W11** (rollover) · **W10** (admissions pipeline) · **Integrity hardening + escalation** (migration 033) · **Teacher media uploads** (R2 presigned, homework/study material) · **Per-school public websites** (DaffodilsPublicSchool, PremchandMahtoInterCollege, router pattern)

Remaining: **W13 report-card PDF generation is DONE** (reportlab, free, download-and-forward).
**W12 (SMS/WhatsApp) removed from scope** — in-app notifications + parent portal Updates tab + CMS announcements fully cover the communication loop without a paid dependency.

## ⚠️ NOT YET DEPLOYED (local-verified, batched for one push) — 2026-06-15

These are built + verified on the dev DB but **held from prod** at user request (batch deploy).
**Migration state verified 2026-06-15:** prod has 001–018 + 021–030 (28 applied, latest
`030_admissions.sql`; 019/020 never existed — redundant RBAC tables). The ONLY pending
migration is **`031_payroll.sql`**. (The old "027–030 not deployed" note was stale — those
are live; it was the *dev* DB that lagged, now caught up.) Deploying also adds `reportlab`
to the backend image.

- **Fee-status fixes (deployed earlier today)** — `due`/`overdue` ledger rows were invisible
  across 5 backend queries + parent portal filter. All fixed and live.
- **Fee receipt PDF (ADR-011)** — `reportlab` dep; `GET /payments/{id}/receipt.pdf`;
  `receipt.get_receipt_context` reconstructs structured data for any paid payment. Verify
  Payments view gains a **Paid · receipt ready** section (approve → download PDF → forward
  manually); Payment Logs receipt no. is a one-click PDF download.
- **Payroll module (ADR-011, migration 031, principal-only)** — consolidated payroll, no
  statutory engine. `staff_salary_structures` / `staff_payroll_runs` / `staff_payslips`.
  Service: salary upsert, run create (snapshots payslip/active staff, `net = gross + Σallow −
  Σdeduct`), payslip edit (draft only), finalize (locks). API under `/payroll`. Payslip PDF.
  New **Payroll** tile (principal): *Staff & Salary* tab → tap staff → drawer (salary editor +
  class assignments + recent payslips); *Monthly Payroll* tab → runs, editable payslips,
  finalize, PDF. End-to-end verified vs dev DB (net math, update, finalize-lock, dup-run guard,
  zero drift). Events: SALARY_STRUCTURE_SET, PAYROLL_RUN_CREATED, PAYROLL_FINALIZED.

## ✅ DEPLOYED 2026-06-15 — integrity escalation + media uploads + per-school sites (migration 033)

**Zero-suspended-state payment integrity (migration 033, worker scheduler):**
- `fee_payments.escalated_at TIMESTAMPTZ NULL` — throttle re-nudge column.
- `admissions.nudged_at TIMESTAMPTZ NULL` — throttle stale-lead nudge column.
- `payment_claim_escalation()` scheduler job: selects `pending_verification` claims ≥2 days old, emits `FEE_CLAIM_ESCALATED` (includes `notify_principal=true` at ≥4 days), sets `escalated_at`. Never auto-rejects.
- `gateway_payment_sweep()` scheduler job: auto-fails dormant gateway `pending`/`processing` orders >24h (no real money attached in Phase 1 static-UPI model); deletes `fee_payment_items` to free ledger; emits `FEE_PAYMENT_TIMEOUT` → parent retry notification.
- `admissions_aging()` scheduler job: non-terminal admissions idle >3 days → `ADMISSION_STALE` → principal/VP notified; throttled by `nudged_at`.
- New handlers: `claim_escalated` (accountant + principal re-notify); `payment_timeout` (parent notify); `admission_stale` (new `handlers/admissions.py`).
- All three jobs registered in `worker/main.py` hourly scan loop alongside `fee_overdue_scan`.
- Dashboard API adds `payment_claims_pending` + `oldest_claim_age_days` to the existing aggregate.
- Frontend: red "To Verify" stat card on Dashboard (hidden when 0); `AgingChip` in PaymentVerification queue (green <2d, amber 2–4d, red ≥4d); urgent red banner at ≥4d; aging chip on Admissions kanban cards.

**Teacher media uploads (R2 presigned — no migration, no new dependency):**
- `uploads.py` ALLOWED_CONTENT_TYPES server-side allowlist (images, PDF, Office MIME types); 415 on disallowed type.
- `frontend/src/api/uploads.ts` — `uploadFiles(files)`: validates type/size (10 MB)/count (5) client-side → POST `/api/v1/uploads/url` for presigned URL → PUT directly to R2 → returns `{name, url}[]`.
- `Homework.tsx` PostForm: file input + "Attach" button → upload chips with remove; attachment_urls included in create payload. PostCard: attachment chips as download links with `fileIcon()` by extension. Works for all three post types.
- Parent portal `HomeworkItem` type + backend model/service expose `attachment_urls` from the existing JSONB column (migration 012). ParentPortal.tsx renders attachment download links.

**Per-school public websites:**
- `PublicSite.tsx` rewritten as a thin slug→component router (`SCHOOL_SITES` map).
- `frontend/src/views/public/DaffodilsPublicSchool.tsx` — full Daffodils-specific site: navy/gold/rose palette, Nursery–VIII, Mesra Ranchi; `NoticeBoard` component for CMS announcements; gallery + footer use `SchoolImage`/`SchoolLogo`. Import paths adjusted for `public/` subdirectory.

Deployed: migration 033 auto-applied via entrypoint; backend + worker rebuilt; frontend 294 kB / 75 kB gzip; all 4 containers healthy.

## ✅ DEPLOYED 2026-06-15 — payroll + fee-PDF batch (migration 031, reportlab)

The above payroll + fee-receipt-PDF batch was deployed to prod: migration 031 auto-applied via
entrypoint, reportlab in the image, frontend rebuilt, nginx restarted. All 4 containers healthy;
apex + tenant SPA 200; payroll routes 400-without-tenant (wired); payroll tables present.

## ⚠️ NOT YET DEPLOYED — report-card PDF (2026-06-15)

W13 (report cards) reframed: **PDF generation is free** (reportlab, already on prod) — only
*auto-delivery* over WhatsApp/SMS (W12) needs paid creds. Built the download-and-forward path,
**no migration, no new dependency**:
- `services/report_card.py` (`build_report_card_context` reuses `exam.compute_term_results` so
  the PDF can't drift from the on-screen sheet) + `services/report_card_pdf.py` (reportlab).
- Staff: `GET /exams/results/report-card.pdf?exam_term_id=&student_id=` (any publish state).
  Exam → Results table gains a per-student **Card → PDF** button.
- Parent: `GET /parent/students/{id}/results/report-card.pdf?exam_term_id=` (published only).
  Parent portal Results gains a **Download PDF** button per term.
- Verified: all three PDFs render (`%PDF-`); frontend tsc+build clean. Ready to deploy
  (code + frontend only — `up -d backend` + frontend_build + nginx; no migration step).

## ✅ 2026-06-14 — W10 Admissions pipeline

**W10 — Admissions pipeline (migration 030, tsc+build clean, bundle 221 kB / 56 kB gzip):**
- `admissions` table: `enquiry→application→docs_pending→approved→enrolled/rejected` state machine.
- `POST /admissions/enquiry` — JWT-exempt public web form endpoint.
- `GET/PATCH /admissions` — pipeline list + state advance with guard (409 on invalid transition).
- `POST /admissions/{id}/enrol` — principal-only orchestrated transaction: auto-generate adm_no, create student, generate fee ledger, mark enrolled, emit ADMISSION_APPROVED.
- Frontend: kanban board with 5 status columns, card-level advance/reject/enrol actions, EnrolModal with year+class+section dropdowns. Wired into principal portal as "Admissions" tile.

## ✅ 2026-06-14 — W11 Academic-year rollover

**W11 — Academic-year rollover (migration 029):**
- `academic_years.status` column (active/archived).
- `rollover_academic_year()` single transaction: validate, carry forward pending/due/overdue fees into new year, clone timetable slots, archive old year, set new as current, emit ACADEMIC_YEAR_ROLLED_OVER.
- `POST /academic-years/{id}/rollover` (principal only) → 409 on invalid state.
- Settings.tsx: UpiPanel extracted + RolloverPanel (create-or-select next year, 2-step confirmation dialog, result summary).

## ✅ 2026-06-14 — W14 Analytics dashboard

**W14 — Analytics aggregates:**
- Dashboard endpoint: fee recovery % (school-wide + per-class), 30-day attendance trend by day, <75% low-attendance alert list. Role-gated: principal/VP gets all; accountant gets fee summary only.
- Stat cards: replaced homework count with defaulter count (overdue payment students).
- DashboardView: fee recovery progress bars per class, attendance sparkline (colour-coded by %), low-attendance list with pct badge. Accountant portal now has a dashboard tile.

## ✅ 2026-06-14 — W9 Fee lifecycle + defaulter report

**W9 — Fee lifecycle (migration 028, tsc+build clean):**
- `fee_ledger.status` extended to `pending|due|overdue|paid|waived`; `due_date` column added; backfilled 5th-of-month (monthly) / June-30 (annual).
- `scheduler.fee_lifecycle_advance()`: daily job advances `pending→due` (on/after due_date), `pending/due→overdue` (past grace window), re-sends FEE_OVERDUE notifications every 7 days.
- Dashboard bug fixed: `fee_outstanding` now counts `pending+due+overdue` (was only `pending`; `overdue` was never set).
- API: `GET /fees/defaulters` (json + csv) + `GET /fees/recovery` (per-class collection rate).
- Frontend: **Defaulters** tab in FeesAdmin — filter by year/class, expand per-student to see overdue entries, Export CSV button. `getDefaulters` + `getFeeRecovery` added to `finance.ts`.

## ✅ 2026-06-14 — W8 Exam lifecycle + Class Assignment Panel

**W8 — Exam term lifecycle (migration 027, verified 7/7, tsc+build clean):**
- `exam_terms.status` VARCHAR `draft|marks_open|locked|published` added; existing published terms synced.
- `transition_term_status()` service enforces valid transitions, emits events (EXAM_MARKS_OPENED, EXAM_MARKS_LOCKED, EXAM_PUBLISHED, EXAM_REOPENED).
- Mark entry guards: `_assert_marks_open()` called in `save_marks` + `save_component_marks` → 409 when not open.
- API: `POST /exams/terms/{id}/status` (principal/VP only).
- Frontend Exam.tsx: new **Manage Terms** tab (principal/VP only) with status chips + lifecycle action buttons; marks entry shows lock banner + disabled Save when term is not open.
- Worker registry: EXAM_MARKS_OPENED / EXAM_MARKS_LOCKED / EXAM_REOPENED registered (no push — internal signals; EXAM_PUBLISHED → parent notify already wired).

**Class Assignment Panel:**
- New `GET /staff/assignments` (tenant-wide, principal/VP) + `DELETE /staff/{id}/assignments/{aid}`.
- New `ClassAssignmentsView` (`frontend/src/views/ClassAssignments.tsx`): assign teachers to class/section/subject, set class-teacher flag, remove assignments — grouped by class-section.
- Wired into principal/VP portal as "Assignments" tile (uses timetable icon).

**Phase 0b — Transport fee fix script:**
- `scripts/fix_transport_fee_data.py` — dry-run + apply; fixes `student_filter='all'` on transport schedules + deletes wrongly-generated pending ledger rows for non-transport students. Run on prod once.

In Progress: **Workflow spine is built and verified locally** (event-consumer worker,
in-app notifications, 5 event-driven workflows + fee-overdue scheduler, feature-flag nav).
Events now *do something*: ATTENDANCE_SESSION_SUBMITTED → parent absent alerts, FEE_PAID →
receipts + accountant reconcile, HOMEWORK_ASSIGNED → parent pings, EXAM_PUBLISHED → results
notices, plus a daily fee-overdue scan. ADR-010 realised as cursor+DLQ (audit_events stays
immutable). See "✅ CHECKPOINT 2026-06-13" below + ARCHITECTURE.md. Lifecycle state machines
(W9+) and delivery adapters (SMS/WhatsApp/PDF, W12–W13) remain.

Next Task: Deploy the spine to production (task 8, gated on approval), then Sprint 5 — W9
fee installment lifecycle + W10 admissions pipeline.

---

# ✅ DEPLOYED 2026-06-13 — UPI payment verification + vector icons + section split

- **UPI payment verification loop** (migration 025, applied to prod): static UPI QR has no
  payee callback, so parent **self-reports** a payment (QR / Open UPI app / "I've paid" + UTR)
  → `pending_verification` → accountant **Verify Payments** queue → approve (ledger paid +
  receipt via FEE_PAID) or reject (reason → parent notified). Events FEE_PAYMENT_CLAIMED /
  FEE_PAYMENT_REJECTED. The ONLY automatic verification remains the (dormant) gateway webhook;
  this closes the loop for the free static-UPI schools.
- **Parent portal** rebuilt as a big-button launcher (Fees/Attendance/Homework/Announcements/
  Timetable/Results); Fees = Due (month groups) + Paid tabs. *(Timetable/Results are graceful
  stubs pending parent read endpoints.)*
- **Vector icons** (ui/icons.tsx, inline SVG) replaced emojis; **Homework / Announcements /
  Study Material** split into separate sections (were clubbed).
- Verified vs dev DB (claim/approve/reject/dedup, zero drift); deployed; smoke 200/401 green.

# ✅ DEPLOYED 2026-06-13 — Role portals + design system + daily attendance

Directive: Tulips.edu = multiple role-specific apps over one backend, composed from
permissions (see ARCHITECTURE.md + memory role-based-portal-framework), all sharing ONE
design system inherited from the landing page. Attendance = strict DAILY model.

## Unified design system + dedicated portals — DEPLOYED
- [x] globals.css repointed to the landing brand identity (chalkboard green / tulip /
      marigold on paper; Bricolage+Figtree via CDN, display=swap + system fallback). Stable
      token names → existing views reskinned automatically; hardcoded hex swept to tokens.
- [x] Shared primitives `frontend/src/ui/`: Brand (text wordmark + configurable logoUrl —
      NO placeholder T, no generated logo), Button, Card, Badge, SectionTile, Spinner,
      Empty/Error states.
- [x] `PortalShell` + big-button `PortalHome`: startup = section tiles, click opens a
      dedicated page with back-to-home. `buildPortalConfig` resolves role → Principal/
      Vice-Principal (full, feature-gated), Teacher, Accountant (Fees), SuperAdmin (Platform).
      app.tsx routes all staff through StaffPortal; old AppShell/TeacherShell removed.
- [x] Deployed: rsync → build backend+worker → up backend+worker (no migration) →
      frontend_build → nginx. Live: apex/SPA 200, new bundle served, teacher route 401,
      4 containers healthy. Logo = configurable text wordmark (final logo drops in via logoUrl).

## Attendance directive — DONE (backend, verified local)
- [x] Core daily model already compliant (sessions unique per class/section/day; upsert mark;
      accountant excluded from router). No schema change.
- [x] **Scope holes closed** — mark/submit/get_session now `assert_in_scope` on the session's
      class/section (was open to any session_id). Helper `get_session_scope`.
- [x] **End-of-day lock** (IST): `is_locked(date) = today_IST > session.date`. Teacher edit/
      submit on locked → **423**; principal/admin (class_scope is None) → allowed and emits
      **ATTENDANCE_OVERRIDE** (worker maps it → absent_alert, dedup-safe). `AttendanceSession.locked`
      computed field surfaces state to the UI. No migration (lock derived; zoneinfo stdlib).
- [x] Verified vs dev DB (rolled back, zero drift): teacher-locked 423, admin override allowed +
      event emitted, scope helper. Event documented in ARCHITECTURE.md catalog.

## Teacher portal split — DONE (first slice)
- [x] Backend `GET /teacher/dashboard` (api/v1/teacher.py; teacher/class_teacher only +
      load_class_scope): assigned classes w/ today's attendance status, pending attendance,
      recent homework, notices (class announcements + institution CMS), upcoming exams.
      Exact (class,section) scope match via `unnest($cids,$sids)`. Additive, no schema.
- [x] Frontend: **portal resolution by role** in app.tsx — teacher/class_teacher render a
      dedicated **TeacherShell** (green-themed), NOT the admin AppShell with hidden menus.
      Loads only Today/Attendance/Homework/Timetable/Exams (+ notifications bell); never
      imports staff/finance/settings/CMS. New TeacherDashboard + api/teacher.ts.
- [x] Verified: tsc clean; bundle 179.9 kB / 46.1 kB gzip (+1 kB). RBAC matrix —
      /teacher/dashboard teacher-only (principal/accountant/parent 403); /attendance still
      403 for accountant. 91 routes; app imports clean.
- Next slices (not this pass): accountant portal shell, principal/admin portal polish,
  full permission-driven module loading per role-based-portal-framework memory.

---

# ✅ CHECKPOINT 2026-06-13 — Workflow Spine BUILT + VERIFIED + DEPLOYED TO PROD

Approved plan: `~/.claude/plans/elegant-jumping-widget.md` (scope: spine + first
workflows). ADR-010 amended during planning: audit_events stays immutable; worker uses
a **cursor table + DLQ** (NOT outbox columns). `tenants.feature_flags` already exists
(migration 001, holds gateway SECRETS — never expose wholesale; use allowlist).

## Done + verified locally (tasks 1–7)
- [x] W0 — working tree committed (cda2776, 61 files)
- [x] Migration `024_worker_spine.sql` — worker_cursors (bootstraps at head, no replay),
      worker_dlq, notifications (+dedup unique index), fee_ledger.reminded_at. Applied to dev DB.
- [x] Emit fixes — exam.py publish_term: EXAM_PUBLISHED on false→true in txn w/ FOR UPDATE;
      attendance.py mark_attendance + submit_session wrapped in transactions.
- [x] Notifications service/API — services/notification.py, models/notification.py,
      api/v1/notifications.py (staff, RBAC), parent.py + /parent/notifications*, router registered.
- [x] Worker — backend/worker/{main,registry,scheduler}.py + handlers/{attendance,fees,
      homework,exams}.py. 6 events wired incl. REMINDER_SENT (makes the existing dead
      /fees/reminders button real). config.py: worker_poll_seconds/worker_batch_size.
- [x] Task 5: docker-compose.prod.yml `worker` service (same image, entrypoint
      `python -m worker.main`, depends postgres healthy + backend started); `GET /me/features`
      (api/v1/me.py — allowlist attendance,fees,homework,timetable,exams,cms; absent=true).
- [x] Task 6: frontend — api/notifications.ts, NotificationsBell.tsx (🔔 badge, 45s poll +
      focus/visibility refetch, mounted in AppShell header), ParentPortal "Updates" card,
      feature-flag nav gating in app.tsx. `tsc` clean; bundle 173 kB / 45 kB gzip.
- [x] Task 7: LOCAL VERIFICATION — scripts/verify_worker_spine.py drives the real worker
      code paths against the dev DB (11/11 checks, self-cleaning, zero drift):
      flow1 cursor@head no-replay · flow2 absent fan-out+dedup (rolled back) · flow3 receipt
      push+dedup · flow4 homework ping+idempotent-replay · flow5 exam publish+no-double ·
      flow6 overdue scan+no-repeat · flow7 DLQ poison parks & stream advances · flow8 tenant
      isolation. Plus RBAC matrix (parent/none→403, staff/superadmin→ALLOW) + app imports + 90 routes.

## Task 8 — DEPLOYED to prod 2026-06-13 ✅
- [x] rsync `~/Tulips.edu` → `swap@62.72.13.103:~/tulips` (excluded backend/.env + artifacts);
      `compose build backend worker`; `up -d backend` applied **024 to prod** (worker_cursors
      bootstrapped at head=86, no replay); `up -d worker`; `run --rm frontend_build`
      (173 kB/45 kB gzip, new bundle served); `up -d nginx`.
- [x] Live verification: apex + tenant SPA → 200; `/me/features`, `/notifications`,
      `/parent/notifications` → 401 unauth (routes wired, not 404). Worker's first
      `fee_overdue_scan` created **725 FEE_OVERDUE in-app reminders across 4 tenants** (one-time,
      reminded_at now suppresses repeats); DLQ clean (0); 4 containers healthy, no errors.
- Event-driven handlers (absent/receipt/homework/exam) will fire as staff use the system;
  verified locally 11/11. Not artificially triggered in prod (would notify real parents).

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

## Sprint 6 — Delivery + polish
- ~~**W12. SMS/WhatsApp delivery adapter**~~ — **REMOVED FROM SCOPE.** In-app notifications + parent portal Updates + CMS announcements are the communication layer. No paid provider needed.
- [x] **W13. Report-card PDF** — DONE. reportlab, free. Staff download + parent download both wired. No auto-delivery needed.
- [x] **W14. Analytics aggregates** — DONE. Fee recovery bars, attendance sparkline, low-attendance alert, all precomputed on write.

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

# Public School Website + Path Routing (COMPLETED 2026-06-05, restructured 2026-06-15)

Decision: path-based routing (no new subdomains/cert). One-page CMS-driven site.
- `school.tulipsedu.in/`       → public website (no login)
- `school.tulipsedu.in/app`    → staff ERP
- `school.tulipsedu.in/parent` → parent portal

Built:
- frontend/src/api/cms.ts: cmsPublic (schoolInfo/pages/announcements) — unauthenticated,
  tenant slug from subdomain or ?school= override (for localhost testing).
- frontend/src/app.tsx: AppMode gains 'public'; initialMode() routes by pathname;
  goStaffLogin/goParentLogin/goPublic use history.pushState; popstate listener (doesn't
  disrupt active sessions); parent logout → public, staff logout → /app login.

No backend change, no migration, no new dependency. nginx SPA fallback already serves
all paths → /app and /parent load the SPA which self-routes. Zero infra change.

## Per-school website architecture (2026-06-15)

**Rule: each school has its own completely separate website component — its own design,
colour palette, sections, and copy. No shared layout or theme across schools.**

### File layout

```
frontend/src/views/
  PublicSite.tsx                      ← thin slug→component router only
  public/
    DaffodilsPublicSchool.tsx         ← Daffodils: navy/gold/rose, Nursery–VIII, Mesra Ranchi
    PremchandMahtoInterCollege.tsx    ← Premchand Mahto IC: royal-blue/gold serif, +2 XI–XII, 3 streams (Sci/Com/Arts), JAC, Mesra Neori
    PremchandHighSchool.tsx           ← Premchand High School: same blue/gold serif, Estd 1981, Class I–X Matric (JAC), Manav Vikas Sanstha, Mesra Neori Vikas
    VivekMemorialHighSchool.tsx       ← (to be built when needed)
```

### How the router works

`PublicSite.tsx` resolves the tenant slug (subdomain in prod, `?school=` in dev) and
looks it up in a `SCHOOL_SITES` map. Unknown slugs render a generic "being set up" fallback.

```ts
const SCHOOL_SITES: Record<string, Component> = {
  daffodilspublicschool:   DaffodilsPublicSchool,
  premchandmahtoic:        PremchandMahtoInterCollege,
  premchandhighschool:     PremchandHighSchool,
  vivekmemorialhighschool: VivekMemorialHighSchool,  // add here when built
}
```

### Adding a new school's website

1. Create `frontend/src/views/public/<SchoolSlug>.tsx` — completely from scratch.
   Pick the school's own colours, sections, and copy. Do NOT copy DaffodilsPublicSchool
   and tweak — start fresh for each school.
2. Export a single named component: `export function <SchoolName>({ onStaffLogin, onParentLogin }) { … }`
3. Add one entry to `SCHOOL_SITES` in `PublicSite.tsx`.
4. Typecheck, build, deploy.

### Per-school image assets

Each school's photos live in a slug-named folder:

```
frontend/public/school-assets/<slug>/
  logo.svg        preferred logo (also accepts logo.png; falls back to monogram)
  hero.jpg        homepage hero background
  building.jpg    "About" section building photo
  principal.jpg   principal's photo
  gallery1–9.png  gallery photos
```

- **Local dev**: served from `frontend/public/school-assets/` (default, no env var needed)
- **Production**: set `VITE_SCHOOL_ASSET_BASE=https://cdn.tulipsedu.in/school-assets`
  in the build env and upload matching folder structure to R2. No code changes needed.
- Missing files show a labelled placeholder — assets can be added incrementally.
- The Tulips.edu brand logo (`/tulips-logo.jpg`) is NOT a school asset — it powers the
  PWA icons only. School logos go in their per-slug folder.

Current tenant slugs:

| Slug | School |
|---|---|
| `daffodilspublicschool` | Daffodils Public School, Mesra Ranchi |
| `vivekmemorialhighschool` | Vivek Memorial High School |
| `premchandmahtoic` | Premchand Mahto IC |
| `premchandhighschool` | Premchand High School |

### Notice Board

Each school site should include a Notice Board section (`#notices`) that renders
published `CmsAnnouncement` records from the CMS. Copy the `NoticeBoard` component
pattern from `DaffodilsPublicSchool.tsx` — it takes the `announcements` prop (already
fetched in the root component via `cmsPublic.announcements()`).

### Helper components available in each school's file

Defined locally in each school's `.tsx` (copy in as needed, adapt colours):
- `SchoolImage` — loads `<base>/<slug>/<file>`, falls back to a labelled placeholder
- `SchoolLogo` — tries `logo.svg` → `logo.png` → initial-letter monogram
- `ImgPlaceholder` — consistent labelled placeholder for missing images

---

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
## ADR-012 — Ironclad money integrity (Accepted — 2026-06-15, DEPLOYED, user-approved)
**Reason:** real currency = legal contract; zero tolerance for lost/double rupees. Migration 032
adds `UNIQUE(tenant_id, ledger_id)` on `fee_payment_items` (DB-enforced no-double-pay; reject +
live collectors delete dead items so retries aren't blocked). Daily worker `money_reconciliation`
tripwire (startup + 24h) → MONEY_RECONCILIATION_ALERT on any drift. Pool 10→20. Concurrency proven
(10 simultaneous collects → 1 wins; ₹ conserved). Tests committed: `backend/scripts/
{pipeline_smoke_test,money_concurrency_test}.py`. First prod run flagged 48 mock-seed orphan-paid
rows (payment_id NULL) — seed artifact, not a code bug. Full write-up in ARCHITECTURE.md ADR-012.
## ADR-011 — reportlab PDFs + consolidated payroll (Accepted — 2026-06-15, user-approved)
**Reason:** Fee-receipt + payslip PDFs via pure-Python `reportlab` (no system libs, slim image).
Payroll admitted as a principal-only module despite being OUT OF SCOPE — **consolidated only**
(gross + manual allowance/deduction lines, monthly runs → payslips), **no PF/ESI/TDS engine**.
Migration 031. Full write-up in ARCHITECTURE.md.

---

# Known Issues

- (RESOLVED) Fee add form broken → replaced by Excel import (Step 4a)
- (RESOLVED) Roll numbers not unique → constraint already enforced (migration 006)
- (RESOLVED) Attendance locked after submit → edit-after-submit shipped (Step 2)
- (RESOLVED) Timetable teacher field → `timetable_slots.staff_id` exists (migration 013)
- ⚠️ **Admission-number auto-generation is a PLACEHOLDER — do NOT rely on it yet.**
  `enrol_student` (`api/v1/admissions.py`) currently mints `adm_no` as zero-padded `MAX(...)+1`
  when the principal leaves the field blank. Two problems:
  1. **We don't know each school's admission-number convention.** Real schools use varied
     formats — `2026/001`, `PHS-1234`, class/section-prefixed, registration-register serials,
     etc. A generic 4-digit sequence will diverge from (or collide with) their real register.
     **Decision pending: gather each tenant's convention first**, then either require the
     principal to enter `adm_no` at enrol (per their scheme) or make the format a per-tenant
     config. Until then, treat auto-gen as a fallback only — prefer manual entry.
  2. **Latent 500:** the `CAST(REGEXP_REPLACE(admission_no,'[^0-9]','','g') AS INTEGER)` throws
     `invalid input syntax for type integer` if any existing student's `admission_no` is fully
     non-numeric (the regex yields `''`, and `CAST('' AS INTEGER)` errors), aborting the enrol
     transaction. Also a per-tenant race: two concurrent enrolments can read the same MAX →
     `unique_tenant_admission_no` violation. When the convention is known, harden alongside it
     (filter to purely-numeric rows + serialize per-tenant via advisory lock, keeping
     uniqueness on `(tenant_id, admission_no)`).
- Feature flags (`tenants.features` JSONB) mandated by CLAUDE.md but NOT built — see W4.
  (ROADMAP previously mislabelled migration 023 as this; 023 is the transport fee filter.)
- Domain events are recorded but not consumed (no worker) — the central Phase-2 gap (W1–W2).

---

# Blockers

- R2 school-asset images: `school-assets/<slug>/` folder needs actual photos uploaded to the R2 bucket for per-school public website photos to appear (currently placeholders).

---

# Pre-Onboarding (before the first REAL school goes live)

- **Load test with Locust (capacity check).** The whole stack runs on one ~₹2,000/month VPS
  (4 gunicorn workers, asyncpg pool max 20). Before a real institution leans on it, validate the
  box survives the realistic *spiky* load — not a uniform sweep of all endpoints:
  - Attendance-mark burst at ~9am (every teacher at once; offline IndexedDB queues flushing on
    reconnect) — the signature ClassSwipe scenario.
  - Login storm (staff + parents at day start).
  - Fee-collection window (accountant collect + parent UPI claims).
  - Report-card / receipt **PDF generation** (reportlab, CPU-heavy — likeliest to pin the box).
  - Dashboard aggregates under concurrent principals.
  Run against a **throwaway `qa-test` tenant off-hours** (same prod-safety rule as the test suite)
  or a staging replica — NOT against the live box during school hours. A focused ~5-scenario
  `locustfile.py` (or k6) beats a broad sweep. Goal: find the capacity ceiling so we know when to
  scale. (Correctness-under-concurrency for money is already covered by
  `backend/scripts/money_concurrency_test.py`.)

# Pending Post-Launch

- SSL auto-renew cron: `certbot renew --quiet && docker compose -f ~/tulips/docker-compose.prod.yml exec nginx nginx -s reload`
- R2 env vars: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL
