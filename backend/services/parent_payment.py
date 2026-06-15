"""Parent self-reported UPI payments + accountant verification.

Static UPI QR has no gateway callback, so a parent pays directly to the school's
VPA and then *claims* the payment here. The claim creates a fee_payments row in
'pending_verification' (ledger stays unpaid) carrying the optional UTR. An
accountant reconciles it against the bank statement and approves (→ ledger paid +
receipt via FEE_PAID) or rejects (→ parent notified). See migration 025.
"""

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

import asyncpg

from core.events import emit
from models.finance import FeePaymentResponse
from services.receipt import IST, generate_receipt_html, period_label


class ParentPaymentError(Exception):
    pass


# Statuses that already "claim" a ledger row — block a second claim against them.
_LIVE_STATUSES = ("pending_verification", "processing", "paid")


async def submit_claim(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    student_id: uuid.UUID,
    ledger_ids: list[uuid.UUID],
    reference_no: Optional[str],
) -> uuid.UUID:
    """Parent marks selected pending ledger rows as paid (awaiting verification)."""
    if not ledger_ids:
        raise ParentPaymentError("No fee rows selected")

    async with conn.transaction():
        rows = await conn.fetch(
            """
            SELECT id, amount_due FROM fee_ledger
            WHERE tenant_id = $1 AND student_id = $2 AND id = ANY($3::uuid[])
              AND status IN ('pending', 'due', 'overdue')
            FOR UPDATE
            """,
            tenant_id, student_id, ledger_ids,
        )
        if len(rows) != len(ledger_ids):
            raise ParentPaymentError("Some fees are not payable (already paid or not found)")

        # Block double-claim: any of these rows already covered by a live payment?
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
            raise ParentPaymentError("A payment for these fees is already awaiting approval")

        total: Decimal = sum(r["amount_due"] for r in rows)
        payment_id = await conn.fetchval(
            """
            INSERT INTO fee_payments
                (tenant_id, student_id, payment_ref, gateway, amount, status,
                 payment_method, reference_no)
            VALUES ($1, $2, $3, 'upi', $4, 'pending_verification', 'upi', $5)
            RETURNING id
            """,
            tenant_id, student_id, str(uuid.uuid4()), total,
            (reference_no or "").strip()[:40] or None,
        )
        # Supersede any dead-payment line items on these rows (rejected/failed/
        # refunded/abandoned-gateway) so the double-pay UNIQUE guard isn't tripped
        # by a stale attempt. Live items can't exist here — the dup-check above bars them.
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
        await emit(conn, "FEE_PAYMENT_CLAIMED", tenant_id, {
            "payment_id": str(payment_id),
            "student_id": str(student_id),
            "amount": str(total),
        })
    return payment_id


async def list_for_student(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, student_id: uuid.UUID
) -> list[dict]:
    """Parent's payment history with the months each one covers.

    Covers EVERY payment for the child — parent-claimed UPI (pending/paid/rejected)
    AND office-recorded payments (cash/gateway) — so a fee the accountant collects
    and marks paid also shows in the parent's Paid section. Failed/abandoned
    gateway attempts are hidden.
    """
    rows = await conn.fetch(
        """
        SELECT fp.id, fp.amount, fp.status, fp.reference_no, fp.receipt_number,
               fp.rejection_reason, fp.created_at, fp.paid_at,
               COALESCE(string_agg(
                   to_char(make_date(fl.period_year::int, COALESCE(fl.period_month,1)::int, 1),
                           CASE WHEN fl.period_month IS NULL THEN 'YYYY' ELSE 'Mon YYYY' END),
                   ', ' ORDER BY fl.period_year, fl.period_month), '') AS periods
        FROM fee_payments fp
        LEFT JOIN fee_payment_items fpi ON fpi.payment_id = fp.id
        LEFT JOIN fee_ledger fl ON fl.id = fpi.ledger_id
        WHERE fp.tenant_id = $1 AND fp.student_id = $2
          AND fp.status IN ('pending_verification', 'paid', 'rejected')
        GROUP BY fp.id
        ORDER BY fp.created_at DESC
        LIMIT 50
        """,
        tenant_id, student_id,
    )
    return [dict(r) for r in rows]


async def list_pending(conn: asyncpg.Connection, tenant_id: uuid.UUID) -> list[dict]:
    """Accountant verification queue."""
    rows = await conn.fetch(
        """
        SELECT fp.id, fp.amount, fp.reference_no, fp.created_at,
               s.first_name, s.last_name, s.admission_no, c.name AS class_name, sec.name AS section_name,
               COALESCE(string_agg(
                   to_char(make_date(fl.period_year::int, COALESCE(fl.period_month,1)::int, 1),
                           CASE WHEN fl.period_month IS NULL THEN 'YYYY' ELSE 'Mon YYYY' END),
                   ', ' ORDER BY fl.period_year, fl.period_month), '') AS periods
        FROM fee_payments fp
        JOIN students s   ON s.id = fp.student_id
        JOIN classes  c   ON c.id = s.class_id
        JOIN sections sec ON sec.id = s.section_id
        LEFT JOIN fee_payment_items fpi ON fpi.payment_id = fp.id
        LEFT JOIN fee_ledger fl ON fl.id = fpi.ledger_id
        WHERE fp.tenant_id = $1 AND fp.status = 'pending_verification'
        GROUP BY fp.id, s.first_name, s.last_name, s.admission_no, c.name, sec.name
        ORDER BY fp.created_at
        """,
        tenant_id,
    )
    return [dict(r) for r in rows]


async def approve(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, user_id: uuid.UUID, payment_id: uuid.UUID
) -> FeePaymentResponse:
    """Accountant confirms the money arrived → mark paid, issue receipt, emit FEE_PAID."""
    async with conn.transaction():
        row = await conn.fetchrow(
            """
            SELECT fp.*, t.name AS school_name, t.slug AS tenant_slug
            FROM fee_payments fp JOIN tenants t ON t.id = fp.tenant_id
            WHERE fp.id = $1 AND fp.tenant_id = $2 AND fp.status = 'pending_verification'
            FOR UPDATE
            """,
            payment_id, tenant_id,
        )
        if not row:
            raise ParentPaymentError("Payment not found or not awaiting verification")

        counter = await conn.fetchval(
            """
            INSERT INTO fee_receipt_counters (tenant_id, last_number) VALUES ($1, 1)
            ON CONFLICT (tenant_id) DO UPDATE SET last_number = fee_receipt_counters.last_number + 1
            RETURNING last_number
            """,
            tenant_id,
        )
        receipt_number = f"{row['tenant_slug'].upper()}-{datetime.now(IST).year}-{counter:06d}"

        items = await conn.fetch(
            """
            SELECT fh.name, fl.period_month, fl.period_year, fpi.amount
            FROM fee_payment_items fpi
            JOIN fee_ledger fl ON fl.id = fpi.ledger_id
            JOIN fee_heads  fh ON fh.id = fl.fee_head_id
            WHERE fpi.payment_id = $1
            ORDER BY fl.period_year, fl.period_month NULLS FIRST
            """,
            payment_id,
        )
        student = await conn.fetchrow(
            """
            SELECT s.first_name, s.last_name, s.admission_no, c.name AS cn, sec.name AS sn
            FROM students s JOIN classes c ON c.id = s.class_id JOIN sections sec ON sec.id = s.section_id
            WHERE s.id = $1
            """,
            row["student_id"],
        )
        now = datetime.now(timezone.utc)
        receipt_html = generate_receipt_html(
            receipt_number=receipt_number,
            school_name=row["school_name"],
            student_name=f"{student['first_name']} {student['last_name']}",
            admission_no=student["admission_no"],
            class_section=f"{student['cn']} — {student['sn']}",
            payment_method="upi",
            paid_at=now,
            items=[{"description": f"{period_label(r['period_month'], r['period_year'])} — {r['name']}", "amount": r["amount"]} for r in items],
            total=float(row["amount"]),
        )

        updated = await conn.fetchrow(
            """
            UPDATE fee_payments
            SET status = 'paid', paid_at = $1, receipt_number = $2, receipt_html = $3,
                verified_by = $4, verified_at = $1
            WHERE id = $5 RETURNING *
            """,
            now, receipt_number, receipt_html, user_id, payment_id,
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
            "student_id": str(row["student_id"]),
            "amount": str(row["amount"]),
            "receipt_number": receipt_number,
        })
    return FeePaymentResponse(**{k: updated[k] for k in FeePaymentResponse.model_fields})


async def reject(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, user_id: uuid.UUID,
    payment_id: uuid.UUID, reason: str,
) -> None:
    """Accountant could not verify → reject; ledger stays pending; parent notified."""
    async with conn.transaction():
        row = await conn.fetchrow(
            """
            UPDATE fee_payments
            SET status = 'rejected', rejection_reason = $3, verified_by = $4, verified_at = NOW()
            WHERE id = $1 AND tenant_id = $2 AND status = 'pending_verification'
            RETURNING student_id, amount
            """,
            payment_id, tenant_id, (reason or "Could not verify payment")[:500], user_id,
        )
        if not row:
            raise ParentPaymentError("Payment not found or not awaiting verification")
        # Free the ledger rows: a rejected claim must not keep holding its line
        # items (they'd block the double-pay UNIQUE guard on a legitimate retry).
        await conn.execute(
            "DELETE FROM fee_payment_items WHERE tenant_id = $1 AND payment_id = $2",
            tenant_id, payment_id,
        )
        await emit(conn, "FEE_PAYMENT_REJECTED", tenant_id, {
            "payment_id": str(payment_id),
            "student_id": str(row["student_id"]),
            "reason": (reason or "")[:200],
        })
