"""Time-based fee lifecycle scheduler.

Runs once per worker poll cycle (typically every few minutes but only does
meaningful work once per day since status transitions happen on date boundaries).

Lifecycle:
  pending → due      when today >= due_date - GRACE_DAYS (entry is approaching/at due date)
  pending/due → overdue  when today > due_date + GRACE_DAYS (past the grace window)

On becoming overdue: emits one FEE_OVERDUE in-app notification per student per
ledger row (dedup via ON CONFLICT DO NOTHING). Sets reminded_at; re-escalates
every REMINDER_INTERVAL_DAYS if still unpaid.
"""

import json
import logging
from datetime import date, timedelta

import asyncpg

logger = logging.getLogger("worker.scheduler")

GRACE_DAYS = 5           # days after due_date before entry is 'overdue'
REMINDER_INTERVAL_DAYS = 7  # re-remind overdue entries every N days


async def fee_lifecycle_advance(conn: asyncpg.Connection) -> dict:
    today = date.today()
    due_cutoff = today                          # pending → due on/after due_date
    overdue_cutoff = today - timedelta(days=GRACE_DAYS)  # pending/due → overdue after grace

    stats: dict[str, int] = {"due": 0, "overdue": 0, "reminded": 0}

    async with conn.transaction():
        # 1. pending → due (on or after due_date, within grace window)
        r = await conn.execute(
            """
            UPDATE fee_ledger
               SET status = 'due'
             WHERE status = 'pending'
               AND due_date IS NOT NULL
               AND due_date <= $1
               AND due_date > $2
               AND status NOT IN ('paid', 'waived')
            """,
            due_cutoff, overdue_cutoff,
        )
        stats["due"] = int((r.split()[-1]))

        # 2. pending/due → overdue (past grace window)
        newly_overdue = await conn.fetch(
            """
            UPDATE fee_ledger
               SET status = 'overdue'
             WHERE status IN ('pending', 'due')
               AND due_date IS NOT NULL
               AND due_date <= $1
               AND status NOT IN ('paid', 'waived')
            RETURNING id, tenant_id, student_id, amount_due, due_date,
                      period_month, period_year
            """,
            overdue_cutoff,
        )
        stats["overdue"] = len(newly_overdue)

        # 3. Overdue that need a (re-)reminder: newly overdue + old overdue past interval
        to_remind = list(newly_overdue) + await conn.fetch(
            """
            SELECT fl.id, fl.tenant_id, fl.student_id, fl.amount_due,
                   fl.due_date, fl.period_month, fl.period_year
            FROM fee_ledger fl
            WHERE fl.status = 'overdue'
              AND (fl.reminded_at IS NULL OR fl.reminded_at < NOW() - INTERVAL '1 day' * $1)
              AND fl.due_date IS NOT NULL
            LIMIT 5000
            """,
            REMINDER_INTERVAL_DAYS,
        )

        if to_remind:
            # Fetch student names in bulk
            student_ids = list({r["student_id"] for r in to_remind})
            names = await conn.fetch(
                "SELECT id, first_name, last_name FROM students WHERE id = ANY($1::uuid[])",
                student_ids,
            )
            name_map = {r["id"]: f"{r['first_name']} {r['last_name']}" for r in names}

            for row in to_remind:
                label = (
                    f"{date(row['period_year'], row['period_month'], 1).strftime('%b %Y')}"
                    if row["period_month"] else f"Annual {row['period_year']}"
                )
                student_name = name_map.get(row["student_id"], "your child")
                await conn.execute(
                    """
                    INSERT INTO notifications
                        (tenant_id, recipient_type, recipient_id, type, title, body, ref)
                    VALUES ($1, 'parent_of_student', $2, 'FEE_OVERDUE',
                            'Fee payment overdue',
                            $3, $4)
                    ON CONFLICT DO NOTHING
                    """,
                    row["tenant_id"], row["student_id"],
                    f"Fee of ₹{row['amount_due']} for {label} is overdue for {student_name}.",
                    str(row["id"]),
                )

            row_ids = [r["id"] for r in to_remind]
            await conn.execute(
                "UPDATE fee_ledger SET reminded_at = NOW() WHERE id = ANY($1::uuid[])",
                row_ids,
            )
            stats["reminded"] = len(to_remind)

            # One audit event per affected tenant
            tenant_counts: dict = {}
            for r in to_remind:
                tenant_counts[r["tenant_id"]] = tenant_counts.get(r["tenant_id"], 0) + 1
            for tenant_id, n in tenant_counts.items():
                await conn.execute(
                    "INSERT INTO audit_events (tenant_id, event_type, payload) VALUES ($1, $2, $3)",
                    tenant_id, "FEE_OVERDUE_REMINDED", json.dumps({"count": n}),
                )

    logger.info(
        "fee_lifecycle_advance: due=%d overdue=%d reminded=%d",
        stats["due"], stats["overdue"], stats["reminded"],
    )
    return stats


# Keep the old name as an alias so the main worker loop can call either name.
async def fee_overdue_scan(conn: asyncpg.Connection) -> int:
    result = await fee_lifecycle_advance(conn)
    return result["reminded"]


async def money_reconciliation(conn: asyncpg.Connection) -> dict:
    """Daily integrity scan over the whole money ledger. Asserts the invariants the
    concurrency tests check, but in production and forever: no fee row in >1 live
    payment, every paid payment's amount equals the sum of its line items, and every
    'paid' ledger row has exactly one paid item + a payment_id. Any violation emits a
    MONEY_RECONCILIATION_ALERT audit event (per tenant) and logs an error — a tripwire
    so a lost/duplicated rupee is caught by the system, not by an angry parent.
    """
    double_pay = await conn.fetch(
        """
        SELECT fpi.tenant_id, count(*) AS n FROM (
          SELECT fpi.tenant_id, fpi.ledger_id
          FROM fee_payment_items fpi JOIN fee_payments fp ON fp.id = fpi.payment_id
          WHERE fp.status IN ('pending_verification', 'processing', 'paid')
          GROUP BY fpi.tenant_id, fpi.ledger_id HAVING count(*) > 1
        ) fpi GROUP BY fpi.tenant_id
        """
    )
    amount_mismatch = await conn.fetch(
        """
        SELECT fp.tenant_id, count(*) AS n FROM fee_payments fp
        WHERE fp.status = 'paid'
          AND fp.amount <> (SELECT COALESCE(SUM(amount), 0) FROM fee_payment_items WHERE payment_id = fp.id)
        GROUP BY fp.tenant_id
        """
    )
    orphan_paid = await conn.fetch(
        """
        SELECT fl.tenant_id, count(*) AS n FROM fee_ledger fl
        WHERE fl.status = 'paid'
          AND (fl.payment_id IS NULL
               OR (SELECT count(*) FROM fee_payment_items fpi JOIN fee_payments fp ON fp.id = fpi.payment_id
                   WHERE fpi.ledger_id = fl.id AND fp.status = 'paid') <> 1)
        GROUP BY fl.tenant_id
        """
    )

    by_tenant: dict = {}
    for label, rows in (("double_pay", double_pay), ("amount_mismatch", amount_mismatch), ("orphan_paid", orphan_paid)):
        for r in rows:
            by_tenant.setdefault(r["tenant_id"], {})[label] = r["n"]

    for tenant_id, violations in by_tenant.items():
        logger.error("MONEY_RECONCILIATION_ALERT tenant=%s violations=%s", tenant_id, violations)
        await conn.execute(
            "INSERT INTO audit_events (tenant_id, event_type, payload) VALUES ($1, $2, $3)",
            tenant_id, "MONEY_RECONCILIATION_ALERT", json.dumps(violations),
        )

    total = sum(sum(v.values()) for v in by_tenant.values())
    if not total:
        logger.info("money_reconciliation: clean (0 violations)")
    return {"tenants_flagged": len(by_tenant), "violations": total}
