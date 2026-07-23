"""One-off: DPS always charges 50% of the normal transport fee in May
(owner request, 2026-07-23). Sets the seasonal-reduction fields (migration
043) on the current year's Bus Fee schedule so this applies automatically
every year going forward, then retroactively fixes any May Bus Fee ledger
rows already generated for the current year (pending/due/overdue only —
paid/waived rows are never touched, same rule as everywhere else).

Usage: python scripts/set_dps_may_transport_reduction.py
"""
import asyncio
import os
from decimal import Decimal

import asyncpg

REDUCED_MONTH = 5
REDUCED_PCT = Decimal("50")


async def main():
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    tenant = await conn.fetchrow("SELECT id FROM tenants WHERE slug='daffodilspublicschool'")
    tid = tenant["id"]
    ay = await conn.fetchrow("SELECT id, name FROM academic_years WHERE tenant_id=$1 AND is_current", tid)
    print(f"Tenant: daffodilspublicschool, current year: {ay['name']}")

    async with conn.transaction():
        sched = await conn.fetchrow(
            """
            UPDATE fee_schedules fs
            SET reduced_month = $3, reduced_percentage = $4
            FROM fee_heads fh
            WHERE fs.fee_head_id = fh.id AND fs.tenant_id = $1 AND fs.academic_year_id = $2
              AND fh.name = 'Bus Fee'
            RETURNING fs.id, fs.amount
            """,
            tid, ay["id"], REDUCED_MONTH, REDUCED_PCT,
        )
        if not sched:
            print("ERROR: no 'Bus Fee' schedule found for the current year"); return
        print(f"Schedule updated: Bus Fee (Rs.{sched['amount']}) -> May = {REDUCED_PCT}% (Rs.{sched['amount'] * REDUCED_PCT / 100})")

        # Retroactively fix already-generated May rows this year (pending/due/overdue
        # only). Applies any existing per-student discount on top, same formula as
        # set_student_discounts's recompute.
        result = await conn.execute(
            """
            UPDATE fee_ledger fl
            SET amount_due = ROUND(fs.amount * $4 / 100 * (100 - COALESCE(d.percentage, 0)) / 100, 2)
            FROM fee_schedules fs
            JOIN fee_heads fh ON fh.id = fs.fee_head_id
            LEFT JOIN student_fee_discounts d
                   ON d.tenant_id = fl.tenant_id AND d.student_id = fl.student_id AND d.fee_head_id = fs.fee_head_id
            WHERE fl.tenant_id = $1 AND fl.academic_year_id = $2 AND fl.period_month = $3
              AND fl.status IN ('pending', 'due', 'overdue')
              AND fh.name = 'Bus Fee' AND fl.fee_head_id = fh.id
              AND (fs.class_id IS NULL OR fs.class_id = (SELECT class_id FROM students WHERE id = fl.student_id))
            """,
            tid, ay["id"], REDUCED_MONTH, REDUCED_PCT,
        )
        print(f"Retroactive fix: {result}")

    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
