#!/usr/bin/env python3
"""L3 read-only invariant audit over the REAL tenants.

SELECT-only. Never writes. Scans every non-platform tenant for the corruption
classes that have bitten prod (silent fee-gen skips, NOT-NULL/validator gaps,
double-pay, orphan-paid ledger, duplicate current-year, schedules on dead heads),
prints a per-tenant pass/fail table, and exits non-zero on any violation — so it
can run as a daily cron:

    docker exec tulips-postgres-1 ... # (read-only)
    docker exec tulips-backend-1 python scripts/audit_live_tenants.py

Env:
  DATABASE_URL  default dev DSN

The same CHECKS list is imported by backend/tests/test_invariants_live.py so the
pytest `-m live` run and the cron use one source of truth.
"""
import asyncio
import os
import sys

import asyncpg

DSN = os.environ.get("DATABASE_URL", "postgresql://tulips:tulips@localhost:5432/tulipsedu")

# Each check: (key, human description, SQL returning an INT count of violations).
# $1 is always the tenant_id. 0 == healthy. Anything > 0 is a violation.
CHECKS: list[tuple[str, str, str]] = [
    ("paid_ledger_integrity",
     "every status='paid' ledger row has a payment_id + exactly one payment item",
     """SELECT count(*) FROM fee_ledger fl
        WHERE fl.tenant_id=$1 AND fl.status='paid'
          AND (fl.payment_id IS NULL
               OR (SELECT count(*) FROM fee_payment_items i WHERE i.ledger_id=fl.id) <> 1)"""),

    ("double_pay",
     "no ledger row is covered by more than one LIVE payment",
     """SELECT count(*) FROM (
            SELECT i.ledger_id FROM fee_payment_items i
            JOIN fee_payments p ON p.id=i.payment_id
            WHERE i.tenant_id=$1 AND p.status IN ('paid','processing','pending_verification')
            GROUP BY i.ledger_id HAVING count(*) > 1
        ) x"""),

    ("payment_amount_conservation",
     "every paid payment's amount equals the sum of its items",
     """SELECT count(*) FROM fee_payments p
        WHERE p.tenant_id=$1 AND p.status='paid'
          AND p.amount <> COALESCE((SELECT sum(i.amount) FROM fee_payment_items i WHERE i.payment_id=p.id),0)"""),

    ("enrolled_without_student",
     "every enrolled admission points at a student that exists",
     """SELECT count(*) FROM admissions a
        WHERE a.tenant_id=$1 AND a.status='enrolled'
          AND (a.student_id IS NULL OR NOT EXISTS (SELECT 1 FROM students s WHERE s.id=a.student_id))"""),

    ("enrolled_student_no_fees",
     "enrolled students have a fee ledger when the school has active fee schedules (the silent fee-gen skip)",
     """SELECT count(*) FROM admissions a
        JOIN students s ON s.id=a.student_id
        WHERE a.tenant_id=$1 AND a.status='enrolled'
          AND NOT EXISTS (SELECT 1 FROM fee_ledger fl WHERE fl.student_id=s.id)
          AND EXISTS (SELECT 1 FROM fee_schedules fs JOIN fee_heads fh ON fh.id=fs.fee_head_id
                      WHERE fs.tenant_id=$1 AND fs.academic_year_id=s.academic_year_id AND fh.is_active)"""),

    ("student_missing_required",
     "no active student with null/blank gender or parent_phone",
     """SELECT count(*) FROM students
        WHERE tenant_id=$1 AND is_active
          AND (gender IS NULL OR gender='' OR parent_phone IS NULL OR parent_phone='')"""),

    ("student_bad_phone",
     "every active student's parent_phone is a valid 10-digit Indian mobile",
     r"""SELECT count(*) FROM students
        WHERE tenant_id=$1 AND is_active AND parent_phone !~ '^[6-9][0-9]{9}$'"""),

    ("student_bad_gender",
     "every active student's gender is Male/Female/Other",
     """SELECT count(*) FROM students
        WHERE tenant_id=$1 AND is_active AND gender NOT IN ('Male','Female','Other')"""),

    ("staff_bad_phone",
     "every active staff phone_number is a valid 10-digit Indian mobile",
     r"""SELECT count(*) FROM staff
        WHERE tenant_id=$1 AND is_active AND phone_number !~ '^[6-9][0-9]{9}$'"""),

    ("multiple_current_years",
     "at most one is_current academic year per tenant",
     "SELECT GREATEST(count(*)-1, 0) FROM academic_years WHERE tenant_id=$1 AND is_current"),

    ("schedule_on_inactive_head",
     "no fee schedule points at a deactivated fee head (it would silently generate nothing)",
     """SELECT count(*) FROM fee_schedules fs JOIN fee_heads fh ON fh.id=fs.fee_head_id
        WHERE fs.tenant_id=$1 AND fh.is_active=false"""),

    ("duplicate_ledger",
     "no duplicate ledger row for the same (student, fee_head, period)",
     """SELECT count(*) FROM (
            SELECT 1 FROM fee_ledger WHERE tenant_id=$1
            GROUP BY student_id, fee_head_id, period_year, period_month
            HAVING count(*) > 1
        ) x"""),

]


async def run(conn: asyncpg.Connection) -> dict[str, dict[str, object]]:
    """Returns {tenant_slug: {check_key: violation_count_or_error_string}}."""
    tenants = await conn.fetch(
        "SELECT id, slug FROM tenants WHERE slug <> 'platform' ORDER BY slug"
    )
    report: dict[str, dict[str, object]] = {}
    for t in tenants:
        row: dict[str, object] = {}
        for key, _desc, sql in CHECKS:
            try:
                row[key] = await conn.fetchval(sql, t["id"])
            except Exception as exc:  # missing column/table → surface, don't crash
                row[key] = f"ERR:{type(exc).__name__}"
        report[t["slug"]] = row
    return report


def _is_violation(v: object) -> bool:
    return isinstance(v, str) or (isinstance(v, int) and v > 0)


async def main() -> None:
    conn = await asyncpg.connect(DSN)
    try:
        report = await run(conn)
    finally:
        await conn.close()

    slugs = list(report.keys())
    print(f"\n=== LIVE-DATA AUDIT  ({len(slugs)} tenants) ===\n")
    violations = 0
    for key, desc, _sql in CHECKS:
        cells = []
        for slug in slugs:
            v = report[slug][key]
            bad = _is_violation(v)
            if bad:
                violations += 1
            cells.append(f"{slug}={'OK' if (not bad and v == 0) else v}")
        mark = "✓" if not any(_is_violation(report[s][key]) for s in slugs) else "✗ FAIL"
        print(f"  {mark}  {key} — {desc}")
        for c in cells:
            tag = ""
            for slug in slugs:
                if c.startswith(slug + "=") and _is_violation(report[slug][key]):
                    tag = "  <-- VIOLATION"
            print(f"        {c}{tag}")
    print()
    if violations:
        print(f"=== {violations} violation(s) found across tenants — see VIOLATION markers above ===")
        sys.exit(1)
    print("=== ALL TENANTS CLEAN ✓ ===")


if __name__ == "__main__":
    asyncio.run(main())
