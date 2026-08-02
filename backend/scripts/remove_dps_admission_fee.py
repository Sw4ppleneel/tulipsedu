"""Remove the recurring "Admission Fee" levy from every DPS student.

Owner, 2026-08-02: "For daffodils, remove admission fee for all students they
dont have admission readmission eevry class". DPS charges admission once, at
first admission -- it is not a per-class/per-year charge, but an all-classes
fee_schedule was levying it on all 406 students.

Scope (owner-confirmed, widened 2026-08-02 after the first run):

  REMOVE   Admission Fee                 Rs.1000
  REMOVE   Admission Form                Rs.200
  REMOVE   Development Fee (Admission)   Rs.300
  REMOVE   Building Fee                  Rs.300   (owner: "the admission building fee")

  KEEP     Development Fee (Annual)      -- owner: "let the normal devlopment
           annual fee stay". Also carries 2 PAID rows, so it must not be touched.
  KEEP     Registration Fee              -- never named by the owner. Zero ledger
           rows but an ARMED all-classes Rs.5000 schedule: the next ledger
           generation levies Rs.20,30,000 across 406 students. Flagged separately;
           do not silently fold it in here.

Idempotent: re-running skips heads already cleared (Admission Fee was removed in
the first run of this script).

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
HEAD_NAMES = [
    "Admission Fee",
    "Admission Form",
    "Development Fee (Admission)",
    "Building Fee",
]
# Guard against a fat-fingered edit ever pulling these into the list above.
NEVER_REMOVE = {"Development Fee (Annual)", "Registration Fee"}


async def main():
    database_url = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(database_url)

    overlap = NEVER_REMOVE & set(HEAD_NAMES)
    if overlap:
        print(f"ABORT: {overlap} is on the protected list — refusing")
        await conn.close()
        return

    tenant_id = await conn.fetchval("SELECT id FROM tenants WHERE slug = $1", TENANT_SLUG)
    if not tenant_id:
        print(f"ERROR: tenant '{TENANT_SLUG}' not found")
        await conn.close()
        return

    for head_name in HEAD_NAMES:
        await _remove_head(conn, tenant_id, head_name)

    await conn.close()


async def _remove_head(conn: asyncpg.Connection, tenant_id, head_name: str) -> None:
    head = await conn.fetchrow(
        "SELECT id, name, fee_type, is_active FROM fee_heads WHERE tenant_id = $1 AND name = $2",
        tenant_id, head_name,
    )
    if not head:
        print(f"SKIP  '{head_name}' not found for {TENANT_SLUG}")
        return
    head_id = head["id"]

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
        print(f"ABORT '{head_name}': {paid} paid row(s), {referenced} receipt reference(s) — "
              f"refusing to delete collected money. Investigate before rerunning.")
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
    if not schedules and not rows:
        print(f"SKIP  '{head_name}' already clear (0 schedules, 0 ledger rows)")
        return
    print(f"'{head_name}' ({head['fee_type']}): removing {schedules} schedule(s), "
          f"{rows} ledger row(s) worth {value}")

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
    print(f"OK    '{head_name}' {deleted}; {left} ledger row(s) remain; "
          f"head still active={still_active} (kept for the admission-fee group)")


if __name__ == "__main__":
    asyncio.run(main())
