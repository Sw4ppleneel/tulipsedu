"""
Fix transport-fee data bug: pending fee_ledger rows exist for non-transport
students because the fee_schedule had student_filter='all' when ledger was
generated (before migration 023 or before the filter was set correctly).

Run on prod ONCE after verifying the output:
  python scripts/fix_transport_fee_data.py --dry-run   # preview only
  python scripts/fix_transport_fee_data.py             # apply fix

Connection uses DATABASE_URL from backend/.env (same as the app).
"""
import asyncio
import os
import sys

import asyncpg
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "../backend/.env"))
DRY_RUN = "--dry-run" in sys.argv


async def main():
    db_url = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(db_url)

    # 1. Find transport-related fee_schedules with student_filter != 'transport'
    wrong_schedules = await conn.fetch("""
        SELECT fs.id, fs.tenant_id, fh.name AS fee_head, fs.student_filter, t.slug
        FROM fee_schedules fs
        JOIN fee_heads fh ON fh.id = fs.fee_head_id
        JOIN tenants t ON t.id = fs.tenant_id
        WHERE LOWER(fh.name) LIKE '%transport%'
          AND fs.student_filter != 'transport'
    """)

    if not wrong_schedules:
        print("No transport fee schedules with wrong student_filter found. Nothing to fix.")
        await conn.close()
        return

    print(f"\nFound {len(wrong_schedules)} transport schedule(s) with student_filter != 'transport':")
    for s in wrong_schedules:
        print(f"  [{s['slug']}] {s['fee_head']} — filter={s['student_filter']!r}")

    # 2. Find pending ledger rows for those schedules where student is NOT transport
    wrong_ledger = await conn.fetch("""
        SELECT fl.id, fl.tenant_id, fl.student_id, fl.period_month, fl.period_year,
               fl.amount_due, st.adm_no, st.full_name, t.slug
        FROM fee_ledger fl
        JOIN fee_schedules fs ON fs.fee_head_id = fl.fee_head_id
                              AND fs.tenant_id = fl.tenant_id
        JOIN fee_heads fh ON fh.id = fl.fee_head_id
        JOIN students st ON st.id = fl.student_id
        JOIN tenants t ON t.id = fl.tenant_id
        WHERE LOWER(fh.name) LIKE '%transport%'
          AND fs.student_filter != 'transport'
          AND st.is_transport = FALSE
          AND fl.status = 'pending'
    """)

    print(f"\nFound {len(wrong_ledger)} pending transport ledger row(s) for non-transport students:")
    for r in wrong_ledger[:20]:
        print(f"  [{r['slug']}] {r['full_name']} ({r['adm_no']}) — "
              f"{r['period_month']}/{r['period_year']} ₹{r['amount_due']}")
    if len(wrong_ledger) > 20:
        print(f"  ... and {len(wrong_ledger) - 20} more")

    if DRY_RUN:
        print("\n[DRY RUN] No changes made. Re-run without --dry-run to apply.")
        await conn.close()
        return

    async with conn.transaction():
        # Fix schedules
        updated = await conn.execute("""
            UPDATE fee_schedules SET student_filter = 'transport'
            WHERE id = ANY($1::uuid[])
        """, [s["id"] for s in wrong_schedules])
        print(f"\nUpdated {updated} schedule(s) → student_filter='transport'")

        # Delete wrong ledger rows
        if wrong_ledger:
            deleted = await conn.execute("""
                DELETE FROM fee_ledger WHERE id = ANY($1::uuid[])
            """, [r["id"] for r in wrong_ledger])
            print(f"Deleted {deleted} pending transport ledger row(s) for non-transport students")

    print("\nDone. Run this again with --dry-run to verify no rows remain.")
    await conn.close()


asyncio.run(main())
