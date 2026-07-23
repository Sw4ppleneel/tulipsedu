"""One-off: add 5 one-time fee heads to daffodilspublicschool (owner request,
2026-07-23) — Exam Fee Term 1/2/3, ID Card Fee, Diary Fee, all Rs.50, applied
to all classes for the current academic year. Generates ledger rows for
every active student (idempotent — ON CONFLICT DO NOTHING, safe to re-run).

Usage: python scripts/add_dps_one_time_fees.py
"""
import asyncio
import os
from decimal import Decimal

import asyncpg

from models.finance import FeeHeadCreate, FeeScheduleCreate
from services.finance import create_fee_head, generate_year_ledger, upsert_fee_schedule

NEW_HEADS = [
    "Exam Fee Term 1",
    "Exam Fee Term 2",
    "Exam Fee Term 3",
    "ID Card Fee",
    "Diary Fee",
]
AMOUNT = Decimal("50")


async def main():
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    tenant = await conn.fetchrow("SELECT id FROM tenants WHERE slug='daffodilspublicschool'")
    tid = tenant["id"]
    ay = await conn.fetchrow("SELECT id, name FROM academic_years WHERE tenant_id=$1 AND is_current", tid)
    print(f"Tenant: daffodilspublicschool, current year: {ay['name']} ({ay['id']})")

    max_sort = await conn.fetchval(
        "SELECT COALESCE(MAX(sort_order), 0) FROM fee_heads WHERE tenant_id=$1", tid
    )

    async with conn.transaction():
        created_heads = []
        for i, name in enumerate(NEW_HEADS, start=1):
            head = await create_fee_head(
                conn, tid, FeeHeadCreate(name=name, fee_type="one_time", sort_order=max_sort + i)
            )
            created_heads.append(head)
            print(f"  fee_head created: {head.name} ({head.id})")

            sched = await upsert_fee_schedule(
                conn, tid, FeeScheduleCreate(
                    fee_head_id=head.id, academic_year_id=ay["id"], class_id=None, amount=AMOUNT,
                )
            )
            print(f"    schedule: all classes, Rs.{sched.amount}, due day {sched.due_day_of_month}")

    result = await generate_year_ledger(conn, tid, ay["id"])
    print(f"\nLedger generation: {result}")

    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
