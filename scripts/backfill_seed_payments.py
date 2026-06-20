#!/usr/bin/env python3
"""
One-off backfill: create real fee_payments/fee_payment_items rows for fee_ledger
rows that were seeded directly with status='paid' but never had a payment record
behind them (see scripts/seed_schools.py).

This is what tripped the daily money_reconciliation() tripwire's orphan_paid
check: that check correctly asserts every 'paid' ledger row must have exactly one
backing paid fee_payment_items row. Seed data took a shortcut and skipped it.

One payment per orphaned ledger row (gateway='offline', payment_method='cash'),
paid_at backdated to the 5th of the fee period so receipts look authentic.
Idempotent — the WHERE clause only ever matches rows still missing payment_id.

Usage:
    cd backend
    PYTHONPATH=. DATABASE_URL=postgresql://tulips:tulips@localhost:5432/tulipsedu \
        python ../scripts/backfill_seed_payments.py
"""

import asyncio
import os
import uuid
from datetime import datetime, timezone

import asyncpg

from services.receipt import IST, generate_receipt_html, period_label  # PYTHONPATH=/app (or backend)


async def backfill(conn: asyncpg.Connection) -> int:
    orphans = await conn.fetch(
        """
        SELECT fl.id AS ledger_id, fl.tenant_id, fl.student_id, fl.amount_due,
               fl.period_month, fl.period_year, fh.name AS fee_head_name,
               t.name AS school_name, t.slug,
               s.first_name, s.last_name, s.admission_no,
               c.name AS class_name, sec.name AS section_name
        FROM fee_ledger fl
        JOIN fee_heads fh ON fh.id = fl.fee_head_id
        JOIN tenants   t  ON t.id = fl.tenant_id
        JOIN students  s  ON s.id = fl.student_id
        JOIN classes   c  ON c.id = s.class_id
        JOIN sections  sec ON sec.id = s.section_id
        WHERE fl.status = 'paid'
          AND (fl.payment_id IS NULL
               OR (SELECT count(*) FROM fee_payment_items fpi
                   JOIN fee_payments fp ON fp.id = fpi.payment_id
                   WHERE fpi.ledger_id = fl.id AND fp.status = 'paid') <> 1)
        ORDER BY fl.tenant_id, fl.period_year, fl.period_month
        """
    )
    if not orphans:
        print("No orphan_paid rows found — nothing to backfill.")
        return 0

    print(f"Found {len(orphans)} orphan_paid ledger rows. Backfilling...\n")
    done = 0
    for row in orphans:
        async with conn.transaction():
            paid_at = datetime(
                row["period_year"], row["period_month"] or 1, 5, 10, 0, tzinfo=IST
            ).astimezone(timezone.utc)

            counter = await conn.fetchval(
                """
                INSERT INTO fee_receipt_counters (tenant_id, last_number) VALUES ($1, 1)
                ON CONFLICT (tenant_id) DO UPDATE SET last_number = fee_receipt_counters.last_number + 1
                RETURNING last_number
                """,
                row["tenant_id"],
            )
            receipt_number = f"{row['slug'].upper()}-{paid_at.astimezone(IST).year}-{counter:06d}"
            label = period_label(row["period_month"], row["period_year"])
            receipt_html = generate_receipt_html(
                receipt_number=receipt_number,
                school_name=row["school_name"],
                student_name=f"{row['first_name']} {row['last_name']}",
                admission_no=row["admission_no"],
                class_section=f"{row['class_name']} — {row['section_name']}",
                payment_method="cash",
                paid_at=paid_at,
                items=[{"description": f"{label} — {row['fee_head_name']}", "amount": row["amount_due"]}],
                total=float(row["amount_due"]),
            )

            payment_id = await conn.fetchval(
                """
                INSERT INTO fee_payments
                    (tenant_id, student_id, payment_ref, gateway, amount, status,
                     payment_method, receipt_number, receipt_html, paid_at, verified_at)
                VALUES ($1, $2, $3, 'offline', $4, 'paid', 'cash', $5, $6, $7, $7)
                RETURNING id
                """,
                row["tenant_id"], row["student_id"], str(uuid.uuid4()),
                row["amount_due"], receipt_number, receipt_html, paid_at,
            )
            await conn.execute(
                "INSERT INTO fee_payment_items (tenant_id, payment_id, ledger_id, amount) VALUES ($1,$2,$3,$4)",
                row["tenant_id"], payment_id, row["ledger_id"], row["amount_due"],
            )
            await conn.execute(
                "UPDATE fee_ledger SET payment_id = $1 WHERE id = $2",
                payment_id, row["ledger_id"],
            )
            done += 1
            print(f"  [{row['slug']}] {row['first_name']} {row['last_name']} — {label} → {receipt_number}")

    return done


async def main() -> None:
    dsn = os.environ.get(
        "DATABASE_URL", "postgresql://tulips:tulips@localhost:5432/tulipsedu"
    )
    conn = await asyncpg.connect(dsn)
    try:
        n = await backfill(conn)
        print(f"\nBackfilled {n} payment record(s).")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
