"""Put DPS's admission-time fee heads into the 'admission' fee group.

Companion to remove_dps_admission_fee.py. That script stripped the schedules
and 1,624 ledger rows (Rs.7,30,800) that were billing every student every
generation. This one makes the arrangement permanent and re-usable:

  1. Tags the four heads with fee_group='admission'. Both schedule queries in
     generate_ledger exclude grouped heads, so from here on these can never be
     levied in bulk again, no matter what schedules exist.
  2. Restores an all-classes schedule per head purely as the AMOUNT source.
     Safe only because of step 1 -- run this AFTER migration 045 and the
     generate_ledger change are deployed, never before, or a generation in the
     gap would re-bill all 406 students.

The group stays OFF: "default deactivated" is the absence of the
admission_fees_active flag, so this script deliberately writes no flag. A
principal or accountant switches it on when they want new admissions charged.

Registration Fee is NOT included -- owner: "dont add registertion fee
ANYWHERE". It keeps its own armed schedule and is untouched here.
"""

import asyncio
import os

import asyncpg

TENANT_SLUG = "daffodilspublicschool"
GROUP = "admission"

# Amounts recovered from the ledger rows removed on 2026-08-02, before deletion.
HEADS = {
    "Admission Fee": 1000,
    "Admission Form": 200,
    "Development Fee (Admission)": 300,
    "Building Fee": 300,
}
NEVER_TAG = {"Development Fee (Annual)", "Registration Fee"}


async def main():
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])

    overlap = NEVER_TAG & set(HEADS)
    if overlap:
        print(f"ABORT: {overlap} is on the protected list — refusing")
        await conn.close()
        return

    has_column = await conn.fetchval(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name='fee_heads' AND column_name='fee_group'"
    )
    if not has_column:
        print("ABORT: fee_heads.fee_group does not exist — deploy migration 045 first")
        await conn.close()
        return

    tenant_id = await conn.fetchval("SELECT id FROM tenants WHERE slug = $1", TENANT_SLUG)
    if not tenant_id:
        print(f"ERROR: tenant '{TENANT_SLUG}' not found")
        await conn.close()
        return

    ay = await conn.fetchval(
        "SELECT id FROM academic_years WHERE tenant_id = $1 AND is_current = TRUE", tenant_id
    )
    if not ay:
        print("ERROR: no current academic year for this tenant")
        await conn.close()
        return

    async with conn.transaction():
        for name, amount in HEADS.items():
            head_id = await conn.fetchval(
                "SELECT id FROM fee_heads WHERE tenant_id = $1 AND name = $2", tenant_id, name
            )
            if not head_id:
                print(f"SKIP  '{name}' not found")
                continue

            await conn.execute(
                "UPDATE fee_heads SET fee_group = $1 WHERE id = $2 AND tenant_id = $3",
                GROUP, head_id, tenant_id,
            )
            # All-classes schedule (class_id NULL) as the amount source. Upsert so
            # a rerun is idempotent rather than raising on the unique index.
            await conn.execute(
                """
                INSERT INTO fee_schedules
                    (tenant_id, fee_head_id, academic_year_id, class_id, amount)
                VALUES ($1, $2, $3, NULL, $4)
                ON CONFLICT (tenant_id, fee_head_id, academic_year_id) WHERE class_id IS NULL
                DO UPDATE SET amount = EXCLUDED.amount
                """,
                tenant_id, head_id, ay, amount,
            )
            print(f"OK    '{name}' -> group '{GROUP}', amount {amount}")

    # Post-condition: tagging must not have created ledger rows for anyone.
    leaked = await conn.fetchval(
        """
        SELECT COUNT(*) FROM fee_ledger fl
        JOIN fee_heads fh ON fh.id = fl.fee_head_id
        WHERE fl.tenant_id = $1 AND fh.fee_group = $2
        """,
        tenant_id, GROUP,
    )
    flags = await conn.fetchval("SELECT feature_flags FROM tenants WHERE id = $1", tenant_id)
    await conn.close()
    print(f"\nledger rows for grouped heads: {leaked} (must be 0)")
    print(f"tenant feature_flags: {flags}")
    print("group is OFF until a principal/accountant switches it on")


if __name__ == "__main__":
    asyncio.run(main())
