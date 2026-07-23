"""One-off: DPS has two fee heads for the same thing — "Bus Fee" (current
2026-2027 year, 1188 ledger rows incl. 91 already paid, has the May 50%
seasonal reduction) and "Transport Fee" (archived 2025-2026 year, 0 ledger
rows, 1 stray student_fee_discounts row). Owner decision, 2026-07-23: keep
"Transport Fee" as the surviving name going forward (broader than "Bus" —
covers vans too), but keep Bus Fee's underlying row (all the real ledger/
payment history + the May rule reference it by id, not name) — a rename,
not a data migration. The old archived-year row is retired (soft-deactivated,
never hard-deleted — same convention as toggle_fee_head), not left dangling
under the name we're about to reuse.

Usage: python scripts/merge_dps_transport_bus_fee.py
"""
import asyncio
import os

import asyncpg


async def main():
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    tenant = await conn.fetchrow("SELECT id FROM tenants WHERE slug='daffodilspublicschool'")
    tid = tenant["id"]

    async with conn.transaction():
        old = await conn.fetchrow(
            "SELECT id FROM fee_heads WHERE tenant_id=$1 AND name='Transport Fee'", tid
        )
        new = await conn.fetchrow(
            "SELECT id FROM fee_heads WHERE tenant_id=$1 AND name='Bus Fee'", tid
        )
        if not old or not new:
            print(f"ERROR: expected both heads to exist. old={old}, new={new}"); return

        # Retire the archived-year row first (frees the "Transport Fee" name
        # before we claim it, and gets it out of the unique constraint's way).
        await conn.execute(
            "UPDATE fee_heads SET name='Transport Fee (2025-26, retired)', is_active=FALSE WHERE id=$1",
            old["id"],
        )
        print("Retired old 'Transport Fee' (2025-26, 0 ledger rows) -> deactivated, renamed")

        # Move its one discount row onto the surviving id. Safe: verified 0
        # existing discount rows on Bus Fee, so no unique-constraint collision.
        moved = await conn.execute(
            "UPDATE student_fee_discounts SET fee_head_id=$2 WHERE fee_head_id=$1",
            old["id"], new["id"],
        )
        print(f"Migrated discount rows: {moved}")

        # Claim the name for the row with the real, live financial history.
        await conn.execute("UPDATE fee_heads SET name='Transport Fee' WHERE id=$1", new["id"])
        print(f"Renamed 'Bus Fee' (id={new['id']}, 1188 ledger rows, 91 paid, May reduction rule) -> 'Transport Fee'")

    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
