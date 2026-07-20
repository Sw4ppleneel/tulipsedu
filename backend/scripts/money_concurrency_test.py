#!/usr/bin/env python3
"""Money-path concurrency + integrity proof against a throwaway tenant.

Fires genuinely concurrent payments at the SAME fee-ledger row and asserts no
rupee is double-counted or lost, then checks system-wide money invariants.
Self-cleaning. Env: BASE_URL, DATABASE_URL, TENANT_SLUG.
"""
import asyncio
import os
import sys
import uuid
from datetime import date

import asyncpg
import httpx

from core.security import hash_password  # PYTHONPATH=/app (or backend)

BASE = os.environ.get("BASE_URL", "http://localhost:8000")
DSN = os.environ.get("DATABASE_URL", "postgresql://tulips:tulips@localhost:5432/tulipsedu")
SLUG = os.environ.get("TENANT_SLUG", f"money-test-{uuid.uuid4().hex[:6]}")
PW = "TestPass123!"
YEAR = date.today().year
out = []


def check(name, ok, detail=""):
    out.append((name, ok, detail))
    print(f"  {'✓' if ok else '✗ FAIL'}  {name}" + (f"  — {detail}" if detail else ""))


async def main():
    print(f"\n=== MONEY CONCURRENCY TEST  tenant={SLUG}  base={BASE} ===\n")
    conn = await asyncpg.connect(DSN)
    tid = await conn.fetchval("INSERT INTO tenants (slug, name) VALUES ($1,$2) RETURNING id", SLUG, "Money Test")
    acc_uid = await conn.fetchval(
        "INSERT INTO users (tenant_id, phone_number, password_hash, role) VALUES ($1,$2,$3,'accountant') RETURNING id",
        tid, "9100000001", hash_password(PW))
    await conn.execute(
        "INSERT INTO user_roles (tenant_id, user_id, role) VALUES ($1,$2,'accountant')", tid, acc_uid)
    prin_uid = await conn.fetchval(
        "INSERT INTO users (tenant_id, phone_number, password_hash, role) VALUES ($1,$2,$3,'principal') RETURNING id",
        tid, "9100000002", hash_password(PW))
    await conn.execute(
        "INSERT INTO user_roles (tenant_id, user_id, role) VALUES ($1,$2,'principal')", tid, prin_uid)

    H = {"X-Tenant-Slug": SLUG}
    try:
        async with httpx.AsyncClient(base_url=f"{BASE}/api/v1", headers=H, timeout=60) as c:
            async def tok(phone):
                r = await c.post("/auth/login", json={"phone_number": phone, "password": PW})
                return r.json()["access_token"]

            ptok = await tok("9100000002")
            atok = await tok("9100000001")
            P = {"Authorization": f"Bearer {ptok}"}
            A = {"Authorization": f"Bearer {atok}"}

            # principal builds base data + ledger (8 monthly rows)
            ay = (await c.post("/academic-years", headers=P, json={"name": f"{YEAR}-{YEAR+1}", "start_date": f"{YEAR}-04-01", "end_date": f"{YEAR+1}-03-31"})).json()["id"]
            cls = (await c.post("/classes", headers=P, json={"name": "C1", "numeric_order": 1})).json()["id"]
            sec = (await c.post(f"/classes/{cls}/sections", headers=P, json={"name": "A"})).json()["id"]
            stu = (await c.post("/students", headers=P, json={"academic_year_id": ay, "class_id": cls, "section_id": sec, "admission_no": "MT001", "roll_number": "1", "first_name": "Money", "last_name": "Test", "date_of_birth": "2015-01-01", "gender": "Male", "parent_phone": "8100000001", "is_hosteler": False})).json()["id"]
            head = (await c.post("/fees/heads", headers=P, json={"name": "Tuition", "fee_type": "monthly"})).json()["id"]
            await c.post("/fees/schedules", headers=P, json={"fee_head_id": head, "academic_year_id": ay, "class_id": cls, "amount": 1000, "due_day_of_month": 5})
            await c.post("/fees/generate-ledger", headers=P, json={"academic_year_id": ay, "month_year_pairs": [{"month": m, "year": YEAR} for m in range(1, 9)], "include_annual": False})
            ledger = (await c.get(f"/fees/ledger?student_id={stu}", headers=P)).json()
            rows = ledger["pending"]
            check("setup: ledger has 8 rows", len(rows) == 8, f"got {len(rows)}")
            amt_each = 1000.0

            # ── Scenario A: 10 concurrent collects of the SAME row ──────────
            row_a = rows[0]["id"]
            res = await asyncio.gather(*[
                c.post("/fees/collect", headers=A, json={"student_id": stu, "ledger_ids": [row_a], "method": "cash"})
                for _ in range(10)
            ], return_exceptions=True)
            codes = [r.status_code for r in res if not isinstance(r, Exception)]
            succ = sum(1 for x in codes if x == 200)
            check("A: same-row x10 → exactly 1 success", succ == 1, f"successes={succ} codes={sorted(codes)}")

            # ── Scenario B: parent-claim vs accountant-collect race (same row) ─
            # parent login
            pr = await c.post("/parent/auth/login", json={"admission_no": "MT001"})
            parent_tok = pr.json()["access_token"]
            PA = {"Authorization": f"Bearer {parent_tok}"}
            row_b = rows[1]["id"]
            res = await asyncio.gather(
                c.post("/fees/collect", headers=A, json={"student_id": stu, "ledger_ids": [row_b], "method": "cash"}),
                c.post("/parent/payments", headers=PA, json={"ledger_ids": [row_b], "reference_no": "UTRX"}),
                return_exceptions=True,
            )
            bcodes = [r.status_code for r in res if not isinstance(r, Exception)]
            b_ok = sum(1 for x in bcodes if x in (200, 201))
            check("B: claim-vs-collect same row → at most 1 live", b_ok <= 1, f"live={b_ok} codes={bcodes}")

            # ── Scenario C: concurrent collects on DISTINCT rows → unique receipts ─
            distinct = [r["id"] for r in rows[2:8]]
            res = await asyncio.gather(*[
                c.post("/fees/collect", headers=A, json={"student_id": stu, "ledger_ids": [rid], "method": "cash"})
                for rid in distinct
            ], return_exceptions=True)
            ok = [r.json() for r in res if not isinstance(r, Exception) and r.status_code == 200]
            receipts = [x["receipt_number"] for x in ok]
            check("C: distinct rows all collected", len(ok) == len(distinct), f"{len(ok)}/{len(distinct)}")
            check("C: receipt numbers all unique", len(set(receipts)) == len(receipts), f"{len(receipts)} recs, {len(set(receipts))} unique")

        # ── Invariants (DB-wide, this tenant) ───────────────────────────────
        # 1. No ledger row paid by more than one LIVE payment
        dupe = await conn.fetchval("""
            SELECT count(*) FROM (
              SELECT fpi.ledger_id FROM fee_payment_items fpi
              JOIN fee_payments fp ON fp.id = fpi.payment_id
              WHERE fpi.tenant_id = $1 AND fp.status IN ('pending_verification','processing','paid')
              GROUP BY fpi.ledger_id HAVING count(*) > 1
            ) d""", tid)
        check("INV: no fee row in >1 live payment (no double-pay)", dupe == 0, f"violations={dupe}")

        # 2. Every payment.amount == sum of its items
        mismatch = await conn.fetchval("""
            SELECT count(*) FROM fee_payments fp
            WHERE fp.tenant_id = $1 AND fp.status = 'paid'
              AND fp.amount <> (SELECT COALESCE(SUM(amount),0) FROM fee_payment_items WHERE payment_id = fp.id)
        """, tid)
        check("INV: payment.amount == Σ items", mismatch == 0, f"mismatches={mismatch}")

        # 3. Every paid ledger row has a payment_id and exactly one paid item
        bad = await conn.fetchval("""
            SELECT count(*) FROM fee_ledger fl
            WHERE fl.tenant_id = $1 AND fl.status = 'paid'
              AND (fl.payment_id IS NULL
                   OR (SELECT count(*) FROM fee_payment_items fpi JOIN fee_payments fp ON fp.id=fpi.payment_id
                       WHERE fpi.ledger_id = fl.id AND fp.status='paid') <> 1)
        """, tid)
        check("INV: paid ledger ⟺ exactly one paid item + payment_id set", bad == 0, f"bad={bad}")

        # 4. Money conservation: collected total == count(paid rows) * amount_each (no lost/extra rupee)
        paid_rows = await conn.fetchval("SELECT count(*) FROM fee_ledger WHERE tenant_id=$1 AND status='paid'", tid)
        paid_sum = await conn.fetchval("SELECT COALESCE(SUM(fpi.amount),0) FROM fee_payment_items fpi JOIN fee_payments fp ON fp.id=fpi.payment_id WHERE fpi.tenant_id=$1 AND fp.status='paid'", tid)
        check("INV: Σ paid items == paid_rows × ₹1000 (no rupee lost/created)",
              float(paid_sum) == paid_rows * amt_each, f"paid_rows={paid_rows} sum={paid_sum} expected={paid_rows*amt_each}")
    finally:
        await conn.execute("DELETE FROM tenants WHERE slug = $1", SLUG)
        await conn.close()
        print(f"\n  (tenant {SLUG} deleted)")

    total = len(out); passed = sum(1 for _, ok, _ in out if ok)
    print(f"\n=== RESULT: {passed}/{total} ===")
    if passed != total:
        print("FAILURES:")
        for n, ok, d in out:
            if not ok:
                print(f"  ✗ {n} — {d}")
        sys.exit(1)
    print("MONEY PATH HELD UNDER CONCURRENCY ✓")


if __name__ == "__main__":
    asyncio.run(main())
