"""Permanent regression tests for the bugs that reached prod.

Each test pins one failure mode so it can never silently return. They run against
the ephemeral tenant (conftest), asserting the real DB EFFECT — not just the
status code, since "200 but wrong/empty DB" is exactly what slipped through.

Requires a running app at BASE_URL + DATABASE_URL (CI / pre-deploy gate). Skipped
shapes that need an unavailable optional dep degrade to skip, never error.
"""
import io
import uuid

import pytest


# ── Bug #2: loose phone validation accepted junk numbers ──────────────────────
def test_student_create_rejects_junk_phone(clients, tenant):
    r = clients["principal"].post("/students", json={
        "academic_year_id": tenant["ay"], "class_id": tenant["cls"], "section_id": tenant["sec"],
        "admission_no": f"RGN{uuid.uuid4().hex[:5]}", "roll_number": "501",
        "first_name": "Junk", "last_name": "Phone", "date_of_birth": "2015-01-01",
        "gender": "Male", "parent_phone": "1234567890", "is_hosteler": False,
    })
    assert r.status_code == 422, f"junk phone must be 422, got {r.status_code}: {r.text[:200]}"


def test_student_create_rejects_bad_gender(clients, tenant):
    r = clients["principal"].post("/students", json={
        "academic_year_id": tenant["ay"], "class_id": tenant["cls"], "section_id": tenant["sec"],
        "admission_no": f"RGN{uuid.uuid4().hex[:5]}", "roll_number": "502",
        "first_name": "Bad", "last_name": "Gender", "date_of_birth": "2015-01-01",
        "gender": "M", "parent_phone": "9876543210", "is_hosteler": False,
    })
    assert r.status_code == 422, f"gender 'M' must be 422, got {r.status_code}: {r.text[:200]}"


# ── Bug #1 + enrol fee-gen: enrol must populate all NOT NULL cols AND make fees ─
def test_enrol_populates_required_columns_and_generates_fees(clients, tenant, db):
    p = clients["principal"]

    # A fee structure must exist so enrolment has something to generate.
    rh = p.post("/fees/heads", json={"name": f"Tuition {uuid.uuid4().hex[:4]}", "fee_type": "monthly"})
    assert rh.status_code in (200, 201), rh.text
    head = rh.json()["id"]
    rs = p.post("/fees/schedules", json={
        "fee_head_id": head, "academic_year_id": tenant["ay"],
        "class_id": tenant["cls"], "amount": 1000, "due_day_of_month": 5,
    })
    assert rs.status_code in (200, 201), rs.text

    # enquiry (public) → advance to approved → enrol
    re = clients["anon"].post("/admissions/enquiry", json={
        "applicant_name": "Reg Enrol", "applicant_dob": "2014-01-01",
        "applying_class_id": tenant["cls"], "parent_name": "P", "parent_phone": "9876543210",
    })
    assert re.status_code in (200, 201), re.text
    adm = re.json()["id"]
    for nxt in ("application", "docs_pending", "approved"):
        rr = p.patch(f"/admissions/{adm}/status", json={"status": nxt})
        assert rr.status_code == 200, f"{nxt}: {rr.status_code} {rr.text[:150]}"

    roll = str(900 + (uuid.uuid4().int % 90))
    ren = p.post(f"/admissions/{adm}/enrol", json={
        "academic_year_id": tenant["ay"], "class_id": tenant["cls"], "section_id": tenant["sec"],
        "roll_number": roll, "gender": "Male", "parent_phone": "9876543210",
        "date_of_birth": "2014-01-01",
    })
    assert ren.status_code == 200, f"enrol must be 200 (not 500), got {ren.status_code}: {ren.text[:200]}"
    sid = ren.json()["student_id"]

    # EFFECT 1: student row exists with all NOT NULL columns populated.
    srow = db("SELECT gender, parent_phone, date_of_birth, roll_number FROM students WHERE id=$1",
              uuid.UUID(sid))
    assert srow, "enrolled student row not found"
    s = srow[0]
    assert s["gender"] and s["parent_phone"] and s["date_of_birth"] and s["roll_number"], \
        f"NOT NULL columns missing: {dict(s)}"

    # EFFECT 2: the fee ledger was generated (the swallowed-ValidationError bug).
    led = db("SELECT count(*) AS n FROM fee_ledger WHERE student_id=$1", uuid.UUID(sid))
    assert led[0]["n"] >= 12, f"enrol generated no fees: {led[0]['n']} ledger rows"


# ── Fee-import bug: re-import must reactivate a deactivated head + regenerate ──
def _fee_xlsx(rows: list[tuple]) -> bytes:
    openpyxl = pytest.importorskip("openpyxl")
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Fee Head", "Fee Type", "Class", "Amount"])
    for r in rows:
        ws.append(list(r))
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_fee_import_reactivates_inactive_head(clients, tenant, db):
    p = clients["principal"]
    name = f"ImpTuition {uuid.uuid4().hex[:4]}"
    xlsx = _fee_xlsx([(name, "monthly", "Class 5", 1000)])
    files = {"file": ("fees.xlsx", xlsx,
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}

    r1 = p.post(f"/fees/import-excel?academic_year_id={tenant['ay']}", files=files)
    assert r1.status_code in (200, 201), f"first import: {r1.status_code} {r1.text[:200]}"
    head = db("SELECT id, is_active FROM fee_heads WHERE tenant_id=$1 AND name=$2",
              uuid.UUID(tenant["tid"]), name)
    assert head and head[0]["is_active"], "head should be active after import"
    hid = head[0]["id"]

    # Deactivate it (simulating the 'cleared fees' state), then re-import.
    p.patch(f"/fees/heads/{hid}/toggle")
    assert not db("SELECT is_active FROM fee_heads WHERE id=$1", hid)[0]["is_active"]

    files = {"file": ("fees.xlsx", _fee_xlsx([(name, "monthly", "Class 5", 1000)]),
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    r2 = p.post(f"/fees/import-excel?academic_year_id={tenant['ay']}", files=files)
    assert r2.status_code in (200, 201), f"re-import: {r2.status_code} {r2.text[:200]}"
    assert db("SELECT is_active FROM fee_heads WHERE id=$1", hid)[0]["is_active"], \
        "re-import must reactivate a deactivated head"


# ── Known-unfixed: adm_no auto-gen crashes on non-numeric existing numbers ────
@pytest.mark.xfail(reason="adm_no CAST(REGEXP_REPLACE...) still throws on non-numeric "
                          "admission numbers — documented in BUILD.md Known Issues, not yet fixed",
                   strict=False)
def test_admno_autogen_tolerates_nonnumeric(clients, tenant, db):
    """Enrol with adm_no blank when a non-numeric admission_no already exists.

    Currently raises (the CAST('' AS INTEGER) bug). Locked as xfail so it flips to
    pass the moment the auto-gen is hardened."""
    p = clients["principal"]
    # Seed a student whose admission_no is fully non-numeric.
    p.post("/students", json={
        "academic_year_id": tenant["ay"], "class_id": tenant["cls"], "section_id": tenant["sec"],
        "admission_no": "ABC", "roll_number": "777", "first_name": "Non", "last_name": "Numeric",
        "date_of_birth": "2015-01-01", "gender": "Male", "parent_phone": "9876543210",
        "is_hosteler": False,
    })
    re = clients["anon"].post("/admissions/enquiry", json={
        "applicant_name": "AdmNo Test", "applying_class_id": tenant["cls"], "parent_phone": "9876500000",
    })
    adm = re.json()["id"]
    for nxt in ("application", "docs_pending", "approved"):
        p.patch(f"/admissions/{adm}/status", json={"status": nxt})
    ren = p.post(f"/admissions/{adm}/enrol", json={
        "academic_year_id": tenant["ay"], "class_id": tenant["cls"], "section_id": tenant["sec"],
        "roll_number": "778", "gender": "Male", "parent_phone": "9876500000",
        "date_of_birth": "2014-01-01",  # adm_no omitted → triggers auto-gen
    })
    assert ren.status_code == 200, f"auto-gen must not 500 on non-numeric existing adm_no: {ren.text[:200]}"


# ── Payment logs were capped at one page, hiding older slips ──────────────────
def test_payment_logs_paginate_over_every_slip(clients, tenant):
    """/fees/logs must expose EVERY payment via limit/offset, not just page one.

    The logs tab used to fetch a flat 200 with no way to reach anything older,
    so schools past that many collections simply could not open those receipts.
    Pages with a deliberately tiny limit so the walk is cheap: the union of all
    pages must equal the total exactly, with no row repeated or skipped (the
    failure mode a non-deterministic ORDER BY would produce).
    """
    p = clients["principal"]

    # A student with a generated ledger gives us entries to collect against.
    rh = p.post("/fees/heads", json={"name": f"Pagi {uuid.uuid4().hex[:4]}", "fee_type": "monthly"})
    assert rh.status_code in (200, 201), rh.text
    rs = p.post("/fees/schedules", json={
        "fee_head_id": rh.json()["id"], "academic_year_id": tenant["ay"],
        "class_id": tenant["cls"], "amount": 500, "due_day_of_month": 5,
    })
    assert rs.status_code in (200, 201), rs.text

    adm = f"PAG{uuid.uuid4().hex[:5]}"
    rc = p.post("/students", json={
        "academic_year_id": tenant["ay"], "class_id": tenant["cls"], "section_id": tenant["sec"],
        "admission_no": adm, "roll_number": str(600 + (uuid.uuid4().int % 90)),
        "first_name": "Pagi", "last_name": "Nation", "date_of_birth": "2015-01-01",
        "gender": "Male", "parent_phone": "9876543210", "is_hosteler": False,
    })
    assert rc.status_code in (200, 201), rc.text
    sid = rc.json()["id"]

    pending = p.get(f"/fees/ledger?student_id={sid}").json()["pending"]
    assert len(pending) >= 5, f"need >=5 pending entries to collect, got {len(pending)}"

    # Five separate collections → five distinct payment rows.
    for entry in pending[:5]:
        rcol = p.post("/fees/collect", json={
            "student_id": sid, "ledger_ids": [entry["id"]], "method": "cash",
        })
        assert rcol.status_code in (200, 201), f"collect: {rcol.status_code} {rcol.text[:200]}"

    first = p.get("/fees/logs?limit=2&offset=0")
    assert first.status_code == 200, first.text
    body = first.json()
    assert isinstance(body, dict) and "items" in body and "total" in body, \
        f"logs must return an items/total envelope, got {type(body)}: {str(body)[:150]}"
    total = body["total"]
    assert total >= 5, f"expected >=5 payments for this tenant, got {total}"

    # Walk every page and collect the ids.
    seen: list[str] = []
    offset = 0
    while offset < total:
        page = p.get(f"/fees/logs?limit=2&offset={offset}").json()
        assert page["total"] == total, f"total shifted mid-walk: {page['total']} != {total}"
        seen.extend(row["id"] for row in page["items"])
        offset += 2

    assert len(seen) == total, f"paging returned {len(seen)} rows for a total of {total}"
    assert len(set(seen)) == total, "a payment appeared on more than one page (unstable ORDER BY)"
