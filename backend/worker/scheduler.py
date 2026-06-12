"""Time-based workflows. v1: fee overdue scan.

Rule: a monthly fee_ledger row is overdue once the calendar passes day
DUE_DAY of its period month. Each overdue pending row produces exactly one
FEE_OVERDUE parent notification (reminded_at marks it done — repeat
escalation can build on this later). Annual/unscheduled rows (period_month
IS NULL) are skipped in v1.

Everything runs in one explicit transaction per scan: notifications insert +
reminded_at stamp + one FEE_OVERDUE_REMINDED audit event per affected tenant.
"""

import json
import logging

import asyncpg

logger = logging.getLogger("worker.scheduler")

DUE_DAY = 10


async def fee_overdue_scan(conn: asyncpg.Connection) -> int:
    async with conn.transaction():
        rows = await conn.fetch(
            """
            WITH overdue AS (
                SELECT fl.id, fl.tenant_id, fl.student_id, fl.amount_due,
                       fl.period_month, fl.period_year,
                       st.first_name, st.last_name
                FROM fee_ledger fl
                JOIN students st ON st.id = fl.student_id AND st.tenant_id = fl.tenant_id
                WHERE fl.status = 'pending'
                  AND fl.reminded_at IS NULL
                  AND fl.period_month IS NOT NULL
                  AND CURRENT_DATE > make_date(fl.period_year::int, fl.period_month::int, $1)
                  AND st.is_active = TRUE
                ORDER BY fl.id
                LIMIT 5000
            ),
            inserted AS (
                INSERT INTO notifications
                    (tenant_id, recipient_type, recipient_id, type, title, body, ref)
                SELECT tenant_id, 'parent_of_student', student_id, 'FEE_OVERDUE',
                       'Fee payment overdue',
                       'Fee of ₹' || amount_due::text || ' for '
                           || to_char(make_date(period_year::int, period_month::int, 1), 'Mon YYYY')
                           || ' is overdue for ' || first_name || ' ' || last_name || '.',
                       id::text
                FROM overdue
                ON CONFLICT DO NOTHING
            )
            UPDATE fee_ledger fl
            SET reminded_at = NOW()
            FROM overdue o
            WHERE fl.id = o.id
            RETURNING fl.tenant_id
            """,
            DUE_DAY,
        )

        if not rows:
            return 0

        # One audit event per affected tenant (event catalog: FEE_OVERDUE_REMINDED).
        counts: dict = {}
        for r in rows:
            counts[r["tenant_id"]] = counts.get(r["tenant_id"], 0) + 1
        for tenant_id, n in counts.items():
            await conn.execute(
                "INSERT INTO audit_events (tenant_id, event_type, payload) VALUES ($1, $2, $3)",
                tenant_id, "FEE_OVERDUE_REMINDED", json.dumps({"count": n}),
            )

    total = len(rows)
    logger.info("fee_overdue_scan: reminded %d ledger rows across %d tenants", total, len(counts))
    return total
