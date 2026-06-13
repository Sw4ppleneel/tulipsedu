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
from services.receipt import generate_receipt_html, period_label

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
              AND fl.status = 'pending'
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
        receipt_number = f"{tenant['slug'].upper()}-{datetime.now().year}-{counter:06d}"
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
