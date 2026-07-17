"""Office-recorded fee collection (cash / cheque / UPI-at-desk / bank transfer).

The accountant has the money in hand, so this marks the selected ledger rows paid
immediately (no verification step) — creating a `gateway='offline'` payment with a
receipt and emitting FEE_PAID (parent receipt + reconcile note). Replaces the old
mock-gateway + DEBUG-gated mock-complete shim. See migration 026.
"""

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

import asyncpg

from core.events import emit
from services.receipt import IST, generate_receipt_html, period_label

METHODS = ("cash", "cheque", "upi", "bank_transfer", "card")
_LIVE_STATUSES = ("pending_verification", "processing", "paid")


class CollectionError(Exception):
    pass


async def record_offline_payment(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    student_id: uuid.UUID,
    ledger_ids: list[uuid.UUID],
    method: str,
    reference_no: Optional[str],
) -> dict:
    if method not in METHODS:
        raise CollectionError(f"Invalid method (expected one of {', '.join(METHODS)})")
    if not ledger_ids:
        raise CollectionError("No fees selected")

    async with conn.transaction():
        rows = await conn.fetch(
            """
            SELECT fl.id, fl.amount_due, fl.period_month, fl.period_year, fh.name AS fee_head_name
            FROM fee_ledger fl
            JOIN fee_heads fh ON fh.id = fl.fee_head_id
            WHERE fl.tenant_id = $1 AND fl.student_id = $2 AND fl.id = ANY($3::uuid[])
              AND fl.status IN ('pending', 'due', 'overdue')
            FOR UPDATE
            """,
            tenant_id, student_id, ledger_ids,
        )
        if len(rows) != len(ledger_ids):
            raise CollectionError("Some fees are not payable (already paid or not found)")

        dup = await conn.fetchval(
            """
            SELECT 1 FROM fee_payment_items fpi
            JOIN fee_payments fp ON fp.id = fpi.payment_id
            WHERE fpi.tenant_id = $1 AND fpi.ledger_id = ANY($2::uuid[])
              AND fp.status = ANY($3::text[])
            LIMIT 1
            """,
            tenant_id, ledger_ids, list(_LIVE_STATUSES),
        )
        if dup:
            raise CollectionError("A payment for these fees already exists")

        tenant = await conn.fetchrow("SELECT name, slug FROM tenants WHERE id = $1", tenant_id)
        student = await conn.fetchrow(
            """
            SELECT s.first_name, s.last_name, s.admission_no, c.name AS cn, sec.name AS sn
            FROM students s JOIN classes c ON c.id = s.class_id JOIN sections sec ON sec.id = s.section_id
            WHERE s.id = $1
            """,
            student_id,
        )

        total: Decimal = sum(r["amount_due"] for r in rows)
        counter = await conn.fetchval(
            """
            INSERT INTO fee_receipt_counters (tenant_id, last_number) VALUES ($1, 1)
            ON CONFLICT (tenant_id) DO UPDATE SET last_number = fee_receipt_counters.last_number + 1
            RETURNING last_number
            """,
            tenant_id,
        )
        receipt_number = f"{tenant['slug'].upper()}-{datetime.now(IST).year}-{counter:06d}"
        now = datetime.now(timezone.utc)
        receipt_html = generate_receipt_html(
            receipt_number=receipt_number,
            school_name=tenant["name"],
            student_name=f"{student['first_name']} {student['last_name']}",
            admission_no=student["admission_no"],
            class_section=f"{student['cn']} — {student['sn']}",
            payment_method=method,
            paid_at=now,
            items=[{"description": f"{period_label(r['period_month'], r['period_year'])} — {r['fee_head_name']}", "amount": r["amount_due"]} for r in rows],
            total=float(total),
        )

        payment_id = await conn.fetchval(
            """
            INSERT INTO fee_payments
                (tenant_id, student_id, payment_ref, gateway, amount, status,
                 payment_method, reference_no, receipt_number, receipt_html,
                 paid_at, verified_by, verified_at)
            VALUES ($1, $2, $3, 'offline', $4, 'paid', $5, $6, $7, $8, $9, $10, $9)
            RETURNING id
            """,
            tenant_id, student_id, str(uuid.uuid4()), total, method,
            (reference_no or "").strip()[:40] or None,
            receipt_number, receipt_html, now, user_id,
        )
        # Supersede dead-payment line items (rejected/failed/refunded/abandoned
        # gateway) on these rows so the double-pay UNIQUE guard isn't tripped by a
        # stale attempt — e.g. a parent claim that was rejected, now collected at the desk.
        await conn.execute(
            """
            DELETE FROM fee_payment_items fpi USING fee_payments fp
            WHERE fpi.payment_id = fp.id AND fpi.tenant_id = $1
              AND fpi.ledger_id = ANY($2::uuid[])
              AND fp.status IN ('rejected', 'failed', 'refunded', 'pending')
            """,
            tenant_id, ledger_ids,
        )
        await conn.executemany(
            "INSERT INTO fee_payment_items (tenant_id, payment_id, ledger_id, amount) VALUES ($1,$2,$3,$4)",
            [(tenant_id, payment_id, r["id"], r["amount_due"]) for r in rows],
        )
        await conn.execute(
            """
            UPDATE fee_ledger fl SET status = 'paid', payment_id = fpi.payment_id
            FROM fee_payment_items fpi WHERE fpi.payment_id = $1 AND fpi.ledger_id = fl.id
            """,
            payment_id,
        )
        await emit(conn, "FEE_PAID", tenant_id, {
            "payment_id": str(payment_id),
            "student_id": str(student_id),
            "amount": str(total),
            "receipt_number": receipt_number,
        })

    return {"payment_id": str(payment_id), "receipt_number": receipt_number}


async def waive_fees(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    student_id: uuid.UUID,
    ledger_ids: list[uuid.UUID],
    reason: str,
) -> dict:
    """Mark the selected unpaid ledger rows as waived (with a mandatory reason).

    A waiver is a revenue decision, not a payment: no fee_payments row, no
    receipt, and the rows drop out of outstanding/defaulter/recovery figures
    without ever counting as collected — the accountant should no longer mark
    concessions as 'paid'."""
    reason = (reason or "").strip()
    if not reason:
        raise CollectionError("A reason is required to waive fees")
    if not ledger_ids:
        raise CollectionError("No fees selected")

    async with conn.transaction():
        rows = await conn.fetch(
            """
            SELECT fl.id, fl.amount_due
            FROM fee_ledger fl
            WHERE fl.tenant_id = $1 AND fl.student_id = $2 AND fl.id = ANY($3::uuid[])
              AND fl.status IN ('pending', 'due', 'overdue')
            FOR UPDATE
            """,
            tenant_id, student_id, ledger_ids,
        )
        if len(rows) != len(ledger_ids):
            raise CollectionError("Some fees are not waivable (already paid or not found)")

        # A row attached to a live payment (e.g. a parent UPI claim awaiting
        # verification) must be resolved through that payment, not waived away.
        live = await conn.fetchval(
            """
            SELECT 1 FROM fee_payment_items fpi
            JOIN fee_payments fp ON fp.id = fpi.payment_id
            WHERE fpi.tenant_id = $1 AND fpi.ledger_id = ANY($2::uuid[])
              AND fp.status = ANY($3::text[])
            LIMIT 1
            """,
            tenant_id, ledger_ids, list(_LIVE_STATUSES),
        )
        if live:
            raise CollectionError("A payment for these fees is in progress — resolve it first")

        await conn.execute(
            """
            UPDATE fee_ledger SET status = 'waived', waiver_reason = $4
            WHERE tenant_id = $1 AND student_id = $2 AND id = ANY($3::uuid[])
            """,
            tenant_id, student_id, ledger_ids, reason[:500],
        )

        total: Decimal = sum(r["amount_due"] for r in rows)
        await emit(conn, "FEE_WAIVED", tenant_id, {
            "student_id": str(student_id),
            "ledger_ids": [str(i) for i in ledger_ids],
            "total": str(total),
            "reason": reason[:500],
            "waived_by": str(user_id),
        })

    return {"waived": len(rows), "total": float(total)}
