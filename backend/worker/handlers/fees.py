"""Fee workflows.

receipt_push (FEE_PAID): parent gets the receipt notification; every accountant
gets a reconciliation note. Dedup ref = payment_id.

manual_reminder (REMINDER_SENT): the accountant's "send reminder" button —
previously only an audit log — now lands a real notification with the student's
outstanding total. Ref = event id, so each deliberate send creates exactly one
notification, while a replay of the same event stays a no-op.
"""

import uuid
from typing import TYPE_CHECKING

import asyncpg

if TYPE_CHECKING:
    from worker.registry import Event


async def receipt_push(conn: asyncpg.Connection, event: "Event") -> None:
    payment_id = event.payload["payment_id"]
    student_id = uuid.UUID(event.payload["student_id"])
    amount = event.payload.get("amount", "")
    receipt_no = event.payload.get("receipt_number", "")

    await conn.execute(
        """
        INSERT INTO notifications
            (tenant_id, recipient_type, recipient_id, type, title, body, ref)
        VALUES ($1, 'parent_of_student', $2, 'FEE_RECEIPT',
                'Payment received',
                'Fee payment of ₹' || $3 || ' received. Receipt no. ' || $4 || '.',
                $5)
        ON CONFLICT DO NOTHING
        """,
        event.tenant_id, student_id, amount, receipt_no, payment_id,
    )

    # Reconciliation note for every accountant of the tenant.
    await conn.execute(
        """
        INSERT INTO notifications
            (tenant_id, recipient_type, recipient_id, type, title, body, ref)
        SELECT $1, 'user', u.id, 'FEE_RECONCILE',
               'Payment to reconcile',
               'Receipt ' || $4 || ' — ₹' || $3
                   || ' received for ' || st.first_name || ' ' || st.last_name
                   || ' (' || st.admission_no || ').',
               $5
        FROM users u
        JOIN students st ON st.id = $2 AND st.tenant_id = $1
        WHERE u.tenant_id = $1 AND u.role = 'accountant'
        ON CONFLICT DO NOTHING
        """,
        event.tenant_id, student_id, amount, receipt_no, payment_id,
    )


async def payment_claimed(conn: asyncpg.Connection, event: "Event") -> None:
    """Parent self-reported a UPI payment → every accountant gets a 'verify' notice."""
    amount = event.payload.get("amount", "")
    await conn.execute(
        """
        INSERT INTO notifications
            (tenant_id, recipient_type, recipient_id, type, title, body, ref)
        SELECT $1, 'user', u.id, 'FEE_VERIFY',
               'Payment to verify',
               'A parent reported a UPI payment of ₹' || $2 || '. Check the bank and approve or reject.',
               $3
        FROM users u
        WHERE u.tenant_id = $1 AND u.role = 'accountant'
        ON CONFLICT DO NOTHING
        """,
        event.tenant_id, amount, event.payload["payment_id"],
    )


async def payment_rejected(conn: asyncpg.Connection, event: "Event") -> None:
    """Accountant could not verify a claimed payment → tell the parent."""
    reason = (event.payload.get("reason") or "").strip()
    await conn.execute(
        """
        INSERT INTO notifications
            (tenant_id, recipient_type, recipient_id, type, title, body, ref)
        VALUES ($1, 'parent_of_student', $2, 'FEE_REJECTED',
                'Payment not verified',
                'Your reported fee payment could not be verified'
                    || CASE WHEN $3 = '' THEN '.' ELSE ': ' || $3 END
                    || ' Please check with the school office.',
                $4)
        ON CONFLICT DO NOTHING
        """,
        event.tenant_id, uuid.UUID(event.payload["student_id"]), reason,
        event.payload["payment_id"],
    )


async def manual_reminder(conn: asyncpg.Connection, event: "Event") -> None:
    student_id = uuid.UUID(event.payload["student_id"])

    await conn.execute(
        """
        INSERT INTO notifications
            (tenant_id, recipient_type, recipient_id, type, title, body, ref)
        SELECT $1, 'parent_of_student', $2, 'FEE_OVERDUE',
               'Fee payment reminder',
               'A fee payment of ₹' || COALESCE(SUM(fl.amount_due), 0)::text
                   || ' is pending for ' || st.first_name || ' ' || st.last_name
                   || '. Please pay at your earliest convenience.',
               $3
        FROM students st
        LEFT JOIN fee_ledger fl
               ON fl.student_id = st.id AND fl.tenant_id = st.tenant_id
              AND fl.status = 'pending'
        WHERE st.id = $2 AND st.tenant_id = $1
        GROUP BY st.first_name, st.last_name
        ON CONFLICT DO NOTHING
        """,
        event.tenant_id, student_id, f"reminder:{event.id}",
    )
