#!/usr/bin/env python3
"""End-to-end pipeline test across ALL role POVs against a throwaway tenant.

Creates an isolated tenant + login users directly in the DB (no provisioning API),
then drives the entire lifecycle over real HTTP (X-Tenant-Slug header) as each role:
superadmin, principal, teacher, accountant, parent. Asserts success paths AND
cross-role RBAC denials. Deletes the tenant (cascade) at the end — always.

Env:
  BASE_URL      default http://localhost:8000
  DATABASE_URL  default dev DSN
  TENANT_SLUG   default pipeline-test (suffix random)
"""
import asyncio
import os
import sys
import uuid
from datetime import date, datetime
from zoneinfo import ZoneInfo

# Attendance end-of-day lock computes "today" in IST; open the session for the
# server's IST date so the lock doesn't fire on a UTC/IST date-boundary skew.
IST_TODAY = datetime.now(ZoneInfo("Asia/Kolkata")).date()

import asyncpg
import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# core.security is importable when run from backend dir (PYTHONPATH=backend)
from core.security import hash_password  # noqa: E402

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8000")
DSN = os.environ.get("DATABASE_URL", "postgresql://tulips:tulips@localhost:5432/tulipsedu")
SLUG = os.environ.get("TENANT_SLUG", f"pipeline-test-{uuid.uuid4().hex[:6]}")
PW = "TestPass123!"

YEAR = date.today().year
results: list[tuple[str, str, bool, str]] = []


def check(pov: str, name: str, ok: bool, detail: str = "") -> None:
    results.append((pov, name, ok, detail))
    mark = "✓" if ok else "✗ FAIL"
    print(f"  [{pov:10}] {mark}  {name}" + (f"  — {detail}" if detail and not ok else ""))


class Client:
    def __init__(self, token: str | None = None):
        self.h = {"X-Tenant-Slug": SLUG}
        if token:
            self.h["Authorization"] = f"Bearer {token}"
        self.c = httpx.Client(base_url=f"{BASE_URL}/api/v1", headers=self.h, timeout=30)

    def req(self, method, path, **kw):
        return self.c.request(method, path, **kw)


async def setup_db() -> dict:
    conn = await asyncpg.connect(DSN)
    tid = await conn.fetchval(
        "INSERT INTO tenants (slug, name) VALUES ($1, $2) RETURNING id", SLUG, "Pipeline Test School"
    )
    users = {}
    for role, phone in [("principal", "9000000001"), ("superadmin", "9000000002"),
                        ("teacher", "9000000003"), ("accountant", "9000000004")]:
        uid = await conn.fetchval(
            "INSERT INTO users (tenant_id, phone_number, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id",
            tid, phone, hash_password(PW), role,
        )
        users[role] = {"id": uid, "phone": phone}
    await conn.close()
    return {"tenant_id": tid, "users": users}


async def teardown_db():
    conn = await asyncpg.connect(DSN)
    await conn.execute("DELETE FROM tenants WHERE slug = $1", SLUG)
    await conn.close()


def login(phone: str) -> str | None:
    r = httpx.post(f"{BASE_URL}/api/v1/auth/login", headers={"X-Tenant-Slug": SLUG},
                   json={"phone_number": phone, "password": PW}, timeout=30)
    return r.json().get("access_token") if r.status_code == 200 else None


def run_http(ctx: dict):
    users = ctx["users"]

    # ── SUPERADMIN POV ──────────────────────────────────────────────────────
    tok = login(users["superadmin"]["phone"])
    check("superadmin", "login", bool(tok))
    sa = Client(tok)
    r = sa.req("GET", "/superadmin/revenue")
    check("superadmin", "platform revenue view", r.status_code == 200, f"{r.status_code}")
    r = sa.req("GET", "/superadmin/payments")
    check("superadmin", "platform payments view", r.status_code == 200, f"{r.status_code}")

    # ── PRINCIPAL POV — full setup ──────────────────────────────────────────
    tok = login(users["principal"]["phone"])
    check("principal", "login", bool(tok))
    p = Client(tok)

    r = p.req("POST", "/academic-years", json={"name": f"{YEAR}-{YEAR+1}", "start_date": f"{YEAR}-04-01", "end_date": f"{YEAR+1}-03-31"})
    check("principal", "create academic year", r.status_code in (200, 201), f"{r.status_code} {r.text[:80]}")
    ay = r.json()["id"]
    p.req("PATCH", f"/academic-years/{ay}/set-current")

    r = p.req("POST", "/classes", json={"name": "Class 5", "numeric_order": 5})
    check("principal", "create class", r.status_code in (200, 201), f"{r.status_code} {r.text[:80]}")
    cls = r.json()["id"]
    r = p.req("POST", f"/classes/{cls}/sections", json={"name": "A"})
    check("principal", "create section", r.status_code in (200, 201), f"{r.status_code} {r.text[:80]}")
    sec = r.json()["id"]

    students = []
    for i in range(1, 4):
        r = p.req("POST", "/students", json={
            "academic_year_id": ay, "class_id": cls, "section_id": sec,
            "admission_no": f"PT{i:03d}", "roll_number": str(i),
            "first_name": f"Student{i}", "last_name": "Test",
            "date_of_birth": "2015-06-01", "gender": "Male",
            "parent_phone": f"880000000{i}", "is_hosteler": False,
        })
        ok = r.status_code in (200, 201)
        check("principal", f"create student PT{i:03d}", ok, f"{r.status_code} {r.text[:80]}")
        if ok:
            students.append(r.json()["id"])

    # staff: teacher + accountant linked to their login users
    r = p.req("POST", "/staff", json={
        "employee_no": "EMP-T1", "first_name": "Tara", "last_name": "Teacher",
        "phone_number": users["teacher"]["phone"], "designation": "Teacher",
        "date_of_joining": f"{YEAR}-04-01", "user_id": str(users["teacher"]["id"]),
    })
    check("principal", "create teacher staff (linked login)", r.status_code in (200, 201), f"{r.status_code} {r.text[:80]}")
    teacher_staff = r.json()["id"] if r.status_code in (200, 201) else None
    r = p.req("POST", "/staff", json={
        "employee_no": "EMP-A1", "first_name": "Anil", "last_name": "Accounts",
        "phone_number": users["accountant"]["phone"], "designation": "Accountant",
        "date_of_joining": f"{YEAR}-04-01", "user_id": str(users["accountant"]["id"]),
    })
    check("principal", "create accountant staff (linked login)", r.status_code in (200, 201), f"{r.status_code}")

    # assign teacher to the class/section
    if teacher_staff:
        r = p.req("POST", f"/staff/{teacher_staff}/assignments", json={
            "academic_year_id": ay, "class_id": cls, "section_id": sec,
            "subject": "Mathematics", "is_class_teacher": True,
        })
        check("principal", "assign teacher to class", r.status_code in (200, 201), f"{r.status_code} {r.text[:80]}")

    # fee structure → ledger
    r = p.req("POST", "/fees/heads", json={"name": "Tuition", "fee_type": "monthly"})
    check("principal", "create fee head", r.status_code in (200, 201), f"{r.status_code} {r.text[:80]}")
    head = r.json()["id"]
    r = p.req("POST", "/fees/schedules", json={"fee_head_id": head, "academic_year_id": ay, "class_id": cls, "amount": 1000, "due_day_of_month": 5})
    check("principal", "create fee schedule", r.status_code in (200, 201), f"{r.status_code} {r.text[:80]}")
    r = p.req("POST", "/fees/generate-ledger", json={"academic_year_id": ay, "month_year_pairs": [{"month": 4, "year": YEAR}, {"month": 5, "year": YEAR}, {"month": 6, "year": YEAR}], "include_annual": False})
    check("principal", "generate fee ledger", r.status_code in (200, 201), f"{r.status_code} {r.text[:80]}")

    # payroll: set salary for teacher → run → finalize → payslip PDF
    r = p.req("PUT", f"/payroll/staff/{teacher_staff}/salary", json={"gross_salary": 30000, "components": [{"name": "HRA", "type": "allowance", "amount": 5000}, {"name": "PF", "type": "deduction", "amount": 1800}]})
    check("principal", "set teacher salary", r.status_code == 200, f"{r.status_code} {r.text[:80]}")
    r = p.req("POST", "/payroll/runs", json={"period_month": 5, "period_year": YEAR})
    check("principal", "create payroll run", r.status_code in (200, 201), f"{r.status_code} {r.text[:80]}")
    run_id = r.json()["id"] if r.status_code in (200, 201) else None
    if run_id:
        r = p.req("GET", f"/payroll/runs/{run_id}/payslips")
        slips = r.json() if r.status_code == 200 else []
        net_ok = slips and abs(float(slips[0]["net_salary"]) - 33200.0) < 0.01
        check("principal", "payslip net math (33200)", net_ok, str(slips[0]["net_salary"]) if slips else "no slips")
        pid = slips[0]["id"] if slips else None
        r = p.req("POST", f"/payroll/runs/{run_id}/finalize")
        check("principal", "finalize payroll run", r.status_code == 200, f"{r.status_code}")
        if pid:
            r = p.req("GET", f"/payroll/payslips/{pid}.pdf")
            check("principal", "payslip PDF", r.status_code == 200 and r.content[:5] == b"%PDF-", f"{r.status_code}")

    # exam: subject + term + config (principal sets up + opens)
    r = p.req("POST", "/exams/subjects", json={"academic_year_id": ay, "class_id": cls, "name": "Mathematics"})
    check("principal", "create exam subject", r.status_code in (200, 201), f"{r.status_code} {r.text[:80]}")
    subj = r.json()["id"] if r.status_code in (200, 201) else None
    r = p.req("POST", "/exams/terms", json={"academic_year_id": ay, "name": "Term 1", "term_type": "unit_test"})
    check("principal", "create exam term", r.status_code in (200, 201), f"{r.status_code} {r.text[:80]}")
    term = r.json()["id"] if r.status_code in (200, 201) else None
    if term and subj:
        r = p.req("PUT", "/exams/marks-config", json={"exam_term_id": term, "exam_subject_id": subj, "max_marks": 100, "passing_marks": 33})
        check("principal", "exam marks config", r.status_code == 200, f"{r.status_code} {r.text[:80]}")
        r = p.req("POST", f"/exams/terms/{term}/status", json={"status": "marks_open"})
        check("principal", "open term for marks", r.status_code == 200, f"{r.status_code} {r.text[:80]}")

    ctx_data = {"ay": ay, "cls": cls, "sec": sec, "students": students, "term": term, "subj": subj}

    # ── TEACHER POV ─────────────────────────────────────────────────────────
    tok = login(users["teacher"]["phone"])
    check("teacher", "login", bool(tok))
    t = Client(tok)
    # attendance: open → mark → submit
    r = t.req("POST", "/attendance/sessions", json={"academic_year_id": ay, "class_id": cls, "section_id": sec, "date": str(IST_TODAY)})
    check("teacher", "open attendance session", r.status_code in (200, 201), f"{r.status_code} {r.text[:80]}")
    if r.status_code in (200, 201):
        sess = r.json()["id"]
        marks = [{"student_id": s, "status": "P" if i else "A"} for i, s in enumerate(students)]
        r = t.req("POST", f"/attendance/sessions/{sess}/mark", json={"marks": marks})
        check("teacher", "mark attendance", r.status_code == 200, f"{r.status_code} {r.text[:80]}")
        r = t.req("POST", f"/attendance/sessions/{sess}/submit")
        check("teacher", "submit attendance", r.status_code == 200, f"{r.status_code}")
    # homework WITH a due_date — exercises the parent-summary HomeworkItem date path
    # (a DATE column flowing into the model; regression guard for the 500 fixed 2026-06-15)
    r = t.req("POST", "/homework", json={"academic_year_id": ay, "class_id": cls, "section_id": sec, "subject": "Mathematics", "post_type": "homework", "title": "Ch 1 sums", "description": "Q1-10", "due_date": str(date.today())})
    check("teacher", "post homework (with due date)", r.status_code in (200, 201), f"{r.status_code} {r.text[:80]}")
    # enter marks
    if term and subj and students:
        entries = [{"student_id": s, "exam_subject_id": subj, "marks_obtained": 80 - i * 10, "is_absent": False} for i, s in enumerate(students)]
        r = t.req("POST", "/exams/marks", json={"exam_term_id": term, "entries": entries})
        check("teacher", "enter exam marks", r.status_code == 200, f"{r.status_code} {r.text[:80]}")
    # RBAC denial: teacher must NOT manage students
    r = t.req("POST", "/students", json={"academic_year_id": ay, "class_id": cls, "section_id": sec, "admission_no": "HACK", "roll_number": "99", "first_name": "X", "last_name": "Y", "date_of_birth": "2015-01-01", "gender": "Male", "parent_phone": "8888888888", "is_hosteler": False})
    check("teacher", "RBAC: cannot create students (403)", r.status_code == 403, f"got {r.status_code}")

    # principal locks + publishes the term (so parents can see results)
    if term:
        p.req("POST", f"/exams/terms/{term}/status", json={"status": "locked"})
        r = p.req("POST", f"/exams/terms/{term}/status", json={"status": "published"})
        check("principal", "publish exam term", r.status_code == 200, f"{r.status_code} {r.text[:80]}")
        # staff report-card PDF
        if students:
            r = p.req("GET", f"/exams/results/report-card.pdf?exam_term_id={term}&student_id={students[0]}")
            check("principal", "report-card PDF (staff)", r.status_code == 200 and r.content[:5] == b"%PDF-", f"{r.status_code}")

    # ── ACCOUNTANT POV ──────────────────────────────────────────────────────
    if not students:
        check("accountant", "fees/parent flows", False, "no students created upstream — skipping")
        return
    tok = login(users["accountant"]["phone"])
    check("accountant", "login", bool(tok))
    a = Client(tok)
    # outstanding + collect month 1 (cash)
    r = a.req("GET", f"/fees/ledger?student_id={students[0]}")
    check("accountant", "view student ledger", r.status_code == 200, f"{r.status_code} {r.text[:80]}")
    ledger = r.json() if r.status_code == 200 else {"pending": []}
    pend = ledger.get("pending", [])
    if pend:
        r = a.req("POST", "/fees/collect", json={"student_id": students[0], "ledger_ids": [pend[0]["id"]], "method": "cash"})
        ok = r.status_code in (200, 201)
        check("accountant", "collect fee (cash) + receipt", ok, f"{r.status_code} {r.text[:80]}")
        if ok:
            rec_pid = r.json().get("payment_id")
            r = a.req("GET", f"/payments/{rec_pid}/receipt.pdf")
            check("accountant", "fee receipt PDF", r.status_code == 200 and r.content[:5] == b"%PDF-", f"{r.status_code}")
    # RBAC denial: accountant must NOT touch attendance
    r = a.req("POST", "/attendance/sessions", json={"academic_year_id": ay, "class_id": cls, "section_id": sec, "date": str(date.today())})
    check("accountant", "RBAC: cannot open attendance (403)", r.status_code == 403, f"got {r.status_code}")

    # ── PARENT POV ──────────────────────────────────────────────────────────
    r = httpx.post(f"{BASE_URL}/api/v1/parent/auth/login", headers={"X-Tenant-Slug": SLUG}, json={"admission_no": "PT001"}, timeout=30)
    check("parent", "login by admission no", r.status_code == 200, f"{r.status_code} {r.text[:80]}")
    if r.status_code == 200:
        pt = Client(r.json()["access_token"])
        sid = students[0]
        r = pt.req("GET", "/parent/students")
        check("parent", "list my students", r.status_code == 200, f"{r.status_code}")
        r = pt.req("GET", f"/parent/students/{sid}/summary")
        check("parent", "student summary (attendance+fees)", r.status_code == 200, f"{r.status_code} {r.text[:80]}")
        r = pt.req("GET", f"/parent/students/{sid}/ledger")
        led = r.json() if r.status_code == 200 else []
        check("parent", "fee ledger visible", r.status_code == 200 and len(led) > 0, f"{r.status_code} n={len(led) if isinstance(led, list) else '?'}")
        # claim a pending payment via UPI
        unpaid = [e for e in led if e.get("status") in ("pending", "due", "overdue")] if isinstance(led, list) else []
        if unpaid:
            r = pt.req("POST", "/parent/payments", json={"ledger_ids": [unpaid[0]["id"]], "reference_no": "UTR123456"})
            check("parent", "claim UPI payment", r.status_code in (200, 201), f"{r.status_code} {r.text[:80]}")
        # results + report card (published)
        r = pt.req("GET", f"/parent/students/{sid}/results")
        check("parent", "view published results", r.status_code == 200, f"{r.status_code} {r.text[:80]}")
        if term:
            r = pt.req("GET", f"/parent/students/{sid}/results/report-card.pdf?exam_term_id={term}")
            check("parent", "report-card PDF (parent)", r.status_code == 200 and r.content[:5] == b"%PDF-", f"{r.status_code}")
        # RBAC denial: parent cannot read staff student roster
        r = pt.req("GET", "/students")
        check("parent", "RBAC: cannot read staff roster (403)", r.status_code == 403, f"got {r.status_code}")

    # ── ACCOUNTANT verifies the parent's UPI claim ──────────────────────────
    r = a.req("GET", "/fees/payments/pending")
    pendpays = r.json() if r.status_code == 200 else []
    check("accountant", "verification queue shows claim", r.status_code == 200 and len(pendpays) > 0, f"{r.status_code} n={len(pendpays) if isinstance(pendpays,list) else '?'}")
    if pendpays:
        r = a.req("POST", f"/fees/payments/{pendpays[0]['id']}/approve")
        check("accountant", "approve UPI claim → receipt", r.status_code == 200, f"{r.status_code} {r.text[:80]}")

    # ── DEFAULTERS (the bug you caught — now must show the unpaid month) ─────
    r = a.req("GET", "/fees/outstanding")
    out = r.json() if r.status_code == 200 else {}
    check("accountant", "outstanding shows unpaid dues", r.status_code == 200 and out.get("items"), f"{r.status_code} items={len(out.get('items', [])) if isinstance(out, dict) else '?'}")


async def main():
    print(f"\n=== PIPELINE TEST  tenant={SLUG}  base={BASE_URL} ===\n")
    ctx = await setup_db()
    try:
        run_http(ctx)
    finally:
        await teardown_db()
        print(f"\n  (tenant {SLUG} deleted — cascade cleanup)")

    total = len(results)
    passed = sum(1 for *_, ok, _ in [(r[0], r[1], r[2], r[3]) for r in results] if ok)
    fails = [r for r in results if not r[2]]
    print(f"\n=== RESULT: {passed}/{total} checks passed ===")
    if fails:
        print("FAILURES:")
        for pov, name, _, detail in fails:
            print(f"  ✗ [{pov}] {name} — {detail}")
        sys.exit(1)
    print("ALL POVs GREEN ✓")


if __name__ == "__main__":
    asyncio.run(main())
