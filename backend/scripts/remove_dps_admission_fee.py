"""Remove the recurring "Admission Fee" levy from every DPS student.

Owner, 2026-08-02: "For daffodils, remove admission fee for all students they
dont have admission readmission eevry class". DPS charges admission once, at
first admission -- it is not a per-class/per-year charge, but an all-classes
fee_schedule was levying it on all 406 students.

Scope is deliberately narrow: ONLY the head named exactly "Admission Fee".
The owner was shown the other three admission-time heads (Admission Form
Rs.200, Development Fee (Admission) Rs.300, Registration Fee Rs.5000 -- the
last of which has an armed all-classes schedule and zero rows) and chose to
leave them in place. Do not widen this script.

Two things happen, in one transaction:
  1. DELETE the head's fee_schedules rows  -> stops future regeneration.
     Without this the ledger rows come back on the next generate-ledger run.
  2. DELETE its unpaid fee_ledger rows     -> clears the current dues.

The fee_head itself stays ACTIVE so it can still be levied per-student from
the staff panel (the companion feature added alongside this).

Refuses to touch anything paid. Verified 0 paid at time of writing, but the
guard re-checks at execution time rather than trusting that snapshot -- a
paid row is real money and deleting it would orphan a receipt. There is also
an FK from fee_payment_items.ledger_id, so a referenced row would raise
rather than silently vanish; the explicit guard just gives a better message.

Reversible from the pre-run backup (tulipsedu-2026-08-02-1235.sql.gz).
"""

import asyncio
import os

import asyncpg

TENANT_SLUG = "daffodilspublicschool"
HEAD_NAME = "Admission Fee"


async def main():
    database_url = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(database_url)

    tenant_id = await conn.fetchval("SELECT id FROM tenants WHERE slug = $1", TENANT_SLUG)
    if not tenant_id:
        print(f"ERROR: tenant '{TENANT_SLUG}' not found")
        await conn.close()
        return

    head = await conn.fetchrow(
        "SELECT id, name, fee_type, is_active FROM fee_heads WHERE tenant_id = $1 AND name = $2",
        tenant_id, HEAD_NAME,
    )
    if not head:
        print(f"ERROR: fee head '{HEAD_NAME}' not found for {TENANT_SLUG}")
        await conn.close()
        return
    head_id = head["id"]
    print(f"head: {head['name']} ({head['fee_type']}, active={head['is_active']})")

    # Guard: never delete a row that has been paid or is referenced by a receipt.
    paid = await conn.fetchval(
        """
        SELECT COUNT(*) FROM fee_ledger
        WHERE tenant_id = $1 AND fee_head_id = $2
          AND (status = 'paid' OR payment_id IS NOT NULL)
        """,
        tenant_id, head_id,
    )
    referenced = await conn.fetchval(
        """
        SELECT COUNT(*) FROM fee_payment_items fpi
        JOIN fee_ledger fl ON fl.id = fpi.ledger_id
        WHERE fl.tenant_id = $1 AND fl.fee_head_id = $2
        """,
        tenant_id, head_id,
    )
    if paid or referenced:
        print(f"ABORT: {paid} paid row(s), {referenced} receipt reference(s) — "
              f"refusing to delete collected money. Investigate before rerunning.")
        await conn.close()
        return

    schedules = await conn.fetchval(
        "SELECT COUNT(*) FROM fee_schedules WHERE tenant_id = $1 AND fee_head_id = $2",
        tenant_id, head_id,
    )
    rows, value = await conn.fetchrow(
        "SELECT COUNT(*), COALESCE(SUM(amount_due), 0) FROM fee_ledger "
        "WHERE tenant_id = $1 AND fee_head_id = $2",
        tenant_id, head_id,
    )
    print(f"to remove: {schedules} schedule(s), {rows} ledger row(s) worth {value}")

    async with conn.transaction():
        await conn.execute(
            "DELETE FROM fee_schedules WHERE tenant_id = $1 AND fee_head_id = $2",
            tenant_id, head_id,
        )
        deleted = await conn.execute(
            "DELETE FROM fee_ledger WHERE tenant_id = $1 AND fee_head_id = $2 "
            "AND status <> 'paid' AND payment_id IS NULL",
            tenant_id, head_id,
        )

    left = await conn.fetchval(
        "SELECT COUNT(*) FROM fee_ledger WHERE tenant_id = $1 AND fee_head_id = $2",
        tenant_id, head_id,
    )
    still_active = await conn.fetchval(
        "SELECT is_active FROM fee_heads WHERE id = $1", head_id,
    )
    await conn.close()
    print(f"OK  {deleted}; {left} ledger row(s) remain; head still active={still_active} "
          f"(kept so it can be levied per-student)")


if __name__ == "__main__":
    asyncio.run(main())
