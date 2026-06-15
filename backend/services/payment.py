import hashlib
import hmac
import json
import logging
import uuid
from base64 import b64encode
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

import asyncpg
import httpx

from core.events import emit
from models.finance import (
    BreakdownItem,
    FeePaymentResponse,
    PaymentOrderCreate,
    PaymentOrderResponse,
)
from services.receipt import IST, generate_receipt_html, period_label

logger = logging.getLogger(__name__)


class PaymentError(Exception):
    pass


# ── Gateway helpers ───────────────────────────────────────────────────────────

async def _create_razorpay_link(
    key_id: str,
    key_secret: str,
    amount_paise: int,
    description: str,
    payment_ref: str,
    callback_url: str,
) -> dict:
    auth = b64encode(f"{key_id}:{key_secret}".encode()).decode()
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            "https://api.razorpay.com/v1/payment_links",
            headers={"Authorization": f"Basic {auth}"},
            json={
                "amount": amount_paise,
                "currency": "INR",
                "description": description,
                "reference_id": payment_ref,
                "upi_link": True,
                "callback_url": callback_url,
                "callback_method": "get",
                "notify": {"sms": False, "email": False},
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return {
            "gateway_order_id": data["id"],
            "payment_url": data["short_url"],
            "qr_url": None,
        }


async def _create_phonepe_order(
    merchant_id: str,
    salt_key: str,
    salt_index: int,
    amount_paise: int,
    payment_ref: str,
    redirect_url: str,
    callback_url: str,
) -> dict:
    payload = {
        "merchantId": merchant_id,
        "merchantTransactionId": payment_ref,
        "amount": amount_paise,
        "redirectUrl": redirect_url,
        "redirectMode": "POST",
        "callbackUrl": callback_url,
        "paymentInstrument": {"type": "PAY_PAGE"},
    }
    encoded = b64encode(json.dumps(payload).encode()).decode()
    digest = hashlib.sha256(f"{encoded}/pg/v1/pay{salt_key}".encode()).hexdigest()
    x_verify = f"{digest}###{salt_index}"

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            "https://api.phonepe.com/apis/hermes/pg/v1/pay",
            headers={"Content-Type": "application/json", "X-VERIFY": x_verify},
            json={"request": encoded},
        )
        resp.raise_for_status()
        data = resp.json()
        redirect = data.get("data", {}).get("instrumentResponse", {}).get("redirectInfo", {})
        return {
            "gateway_order_id": payment_ref,
            "payment_url": redirect.get("url"),
            "qr_url": None,
        }


# ── Create Order ──────────────────────────────────────────────────────────────

async def create_payment_order(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    tenant_slug: str,
    school_name: str,
    feature_flags: dict,
    app_base_url: str,
    data: PaymentOrderCreate,
) -> PaymentOrderResponse:
    # Validate ledger rows — all must be pending and belong to this student + tenant
    placeholders = ", ".join(f"${i + 3}" for i in range(len(data.ledger_ids)))
    ledger_rows = await conn.fetch(
        f"""
        SELECT fl.*, fh.name AS fee_head_name
        FROM fee_ledger fl
        JOIN fee_heads fh ON fh.id = fl.fee_head_id
        WHERE fl.tenant_id = $1 AND fl.student_id = $2
          AND fl.id IN ({placeholders}) AND fl.status IN ('pending', 'due', 'overdue')
        """,
        tenant_id, data.student_id, *data.ledger_ids,
    )
    if len(ledger_rows) != len(data.ledger_ids):
        found = {r["id"] for r in ledger_rows}
        missing = [lid for lid in data.ledger_ids if lid not in found]
        raise PaymentError(f"Ledger entries not found or already paid: {missing}")

    total: Decimal = sum(r["amount_due"] for r in ledger_rows)
    breakdown = [
        BreakdownItem(
            description=f"{period_label(r['period_month'], r['period_year'])} — {r['fee_head_name']}",
            amount=r["amount_due"],
        )
        for r in ledger_rows
    ]
    description = "; ".join(b.description for b in breakdown[:3])
    if len(breakdown) > 3:
        description += f" + {len(breakdown) - 3} more"

    payment_ref = str(uuid.uuid4())

    # Create payment row BEFORE calling gateway (idempotency)
    payment_row = await conn.fetchrow(
        """
        INSERT INTO fee_payments (tenant_id, student_id, payment_ref, gateway, amount)
        VALUES ($1, $2, $3, $4, $5) RETURNING *
        """,
        tenant_id, data.student_id, payment_ref, data.gateway, total,
    )
    payment_id = payment_row["id"]

    # Insert payment items
    await conn.executemany(
        "INSERT INTO fee_payment_items (tenant_id, payment_id, ledger_id, amount) VALUES ($1, $2, $3, $4)",
        [(tenant_id, payment_id, r["id"], r["amount_due"]) for r in ledger_rows],
    )

    # Call gateway
    gateway_order_id = None
    payment_url = None
    qr_url = None

    amount_paise = int(total * 100)
    callback_url = f"{app_base_url}/api/v1/payments/webhooks/{data.gateway}/{tenant_slug}"

    try:
        if data.gateway == "razorpay":
            key_id     = feature_flags.get("razorpay_key_id", "")
            key_secret = feature_flags.get("razorpay_key_secret", "")
            if key_id and key_secret:
                result = await _create_razorpay_link(
                    key_id, key_secret, amount_paise, description, payment_ref,
                    f"{app_base_url}/payment-return",
                )
                gateway_order_id = result["gateway_order_id"]
                payment_url = result["payment_url"]
            else:
                logger.warning("Razorpay credentials not configured — mock mode")
                gateway_order_id = f"mock_{payment_ref}"
                payment_url = f"{app_base_url}/api/v1/payments/{payment_id}/mock-complete"

        elif data.gateway == "phonepe":
            merchant_id = feature_flags.get("phonepe_merchant_id", "")
            salt_key    = feature_flags.get("phonepe_salt_key", "")
            salt_index  = int(feature_flags.get("phonepe_salt_index", 1))
            if merchant_id and salt_key:
                result = await _create_phonepe_order(
                    merchant_id, salt_key, salt_index,
                    amount_paise, payment_ref,
                    f"{app_base_url}/payment-return",
                    callback_url,
                )
                gateway_order_id = result["gateway_order_id"]
                payment_url = result["payment_url"]
            else:
                logger.warning("PhonePe credentials not configured — mock mode")
                gateway_order_id = f"mock_{payment_ref}"
                payment_url = f"{app_base_url}/api/v1/payments/{payment_id}/mock-complete"

        else:  # mock gateway for testing
            gateway_order_id = f"mock_{payment_ref}"
            payment_url = f"{app_base_url}/api/v1/payments/{payment_id}/mock-complete"

    except httpx.HTTPError as e:
        raise PaymentError(f"Gateway error: {e}")

    # Update payment with gateway order ID
    if gateway_order_id:
        await conn.execute(
            "UPDATE fee_payments SET gateway_order_id = $1 WHERE id = $2",
            gateway_order_id, payment_id,
        )

    return PaymentOrderResponse(
        payment_id=payment_id,
        payment_ref=payment_ref,
        gateway=data.gateway,
        gateway_order_id=gateway_order_id,
        payment_url=payment_url,
        qr_url=qr_url,
        amount=total,
        currency="INR",
        status="pending",
        breakdown=breakdown,
        created_at=payment_row["created_at"],
    )


# ── Atomic Payment Success ────────────────────────────────────────────────────

async def _mark_payment_success(
    conn: asyncpg.Connection,
    gateway_order_id: str,
    gateway_payment_id: str,
    payment_method: Optional[str],
) -> Optional[FeePaymentResponse]:
    async with conn.transaction():
        # Grab exclusive lock — NOWAIT rejects concurrent duplicate webhooks
        try:
            row = await conn.fetchrow(
                """
                SELECT fp.*, t.name AS school_name, t.slug AS tenant_slug
                FROM fee_payments fp
                JOIN tenants t ON t.id = fp.tenant_id
                WHERE fp.gateway_order_id = $1
                FOR UPDATE NOWAIT
                """,
                gateway_order_id,
            )
        except asyncpg.exceptions.LockNotAvailableError:
            logger.warning("Concurrent webhook for order %s — skipping", gateway_order_id)
            return None

        if not row:
            logger.warning("No payment found for gateway_order_id %s", gateway_order_id)
            return None

        if row["status"] == "paid":
            return FeePaymentResponse(**{k: row[k] for k in FeePaymentResponse.model_fields})

        if row["status"] not in ("pending", "processing"):
            return None

        # UNIQUE constraint on gateway_payment_id prevents double-processing
        try:
            await conn.execute(
                "UPDATE fee_payments SET gateway_payment_id = $1, status = 'processing' WHERE id = $2",
                gateway_payment_id, row["id"],
            )
        except asyncpg.UniqueViolationError:
            logger.warning("Duplicate gateway_payment_id %s", gateway_payment_id)
            return None

        # Atomic receipt number
        counter = await conn.fetchrow(
            """
            INSERT INTO fee_receipt_counters (tenant_id, last_number)
            VALUES ($1, 1)
            ON CONFLICT (tenant_id)
            DO UPDATE SET last_number = fee_receipt_counters.last_number + 1
            RETURNING last_number
            """,
            row["tenant_id"],
        )
        receipt_number = f"{row['tenant_slug'].upper()}-{datetime.now(IST).year}-{counter['last_number']:06d}"

        # Fetch receipt items
        items = await conn.fetch(
            """
            SELECT fh.name, fl.period_month, fl.period_year, fpi.amount
            FROM fee_payment_items fpi
            JOIN fee_ledger fl ON fl.id = fpi.ledger_id
            JOIN fee_heads fh ON fh.id = fl.fee_head_id
            WHERE fpi.payment_id = $1
            ORDER BY fl.period_year, fl.period_month NULLS FIRST
            """,
            row["id"],
        )

        student = await conn.fetchrow(
            """
            SELECT s.first_name, s.last_name, s.admission_no, c.name AS cn, sec.name AS sn
            FROM students s
            JOIN classes c ON c.id = s.class_id
            JOIN sections sec ON sec.id = s.section_id
            WHERE s.id = $1
            """,
            row["student_id"],
        )

        receipt_items = [
            {"description": f"{period_label(r['period_month'], r['period_year'])} — {r['name']}", "amount": r["amount"]}
            for r in items
        ]
        now = datetime.now(timezone.utc)
        receipt_html = generate_receipt_html(
            receipt_number=receipt_number,
            school_name=row["school_name"],
            student_name=f"{student['first_name']} {student['last_name']}",
            admission_no=student["admission_no"],
            class_section=f"{student['cn']} — {student['sn']}",
            payment_method=payment_method,
            paid_at=now,
            items=receipt_items,
            total=float(row["amount"]),
        )

        updated = await conn.fetchrow(
            """
            UPDATE fee_payments
            SET status = 'paid', paid_at = $1, payment_method = $2,
                receipt_number = $3, receipt_html = $4
            WHERE id = $5 RETURNING *
            """,
            now, payment_method, receipt_number, receipt_html, row["id"],
        )

        # Mark all covered ledger rows as paid — in same transaction
        await conn.execute(
            """
            UPDATE fee_ledger fl
            SET status = 'paid', payment_id = fpi.payment_id
            FROM fee_payment_items fpi
            WHERE fpi.payment_id = $1 AND fpi.ledger_id = fl.id
            """,
            row["id"],
        )

        await emit(conn, "FEE_PAID", row["tenant_id"], {
            "payment_id": str(row["id"]),
            "student_id": str(row["student_id"]),
            "amount": str(row["amount"]),
            "receipt_number": receipt_number,
        })

        return FeePaymentResponse(**dict(updated))


# ── Webhook Handlers ──────────────────────────────────────────────────────────

async def handle_razorpay_webhook(
    conn: asyncpg.Connection,
    tenant_slug: str,
    payload_bytes: bytes,
    signature: str,
) -> bool:
    # Look up webhook secret from tenant feature_flags
    tenant = await conn.fetchrow(
        "SELECT feature_flags FROM tenants WHERE slug = $1", tenant_slug
    )
    if not tenant:
        return False

    webhook_secret = (tenant["feature_flags"] or {}).get("razorpay_webhook_secret", "")
    if webhook_secret:
        expected = hmac.new(webhook_secret.encode(), payload_bytes, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, signature):
            return False

    try:
        event = json.loads(payload_bytes)
    except json.JSONDecodeError:
        return False

    if event.get("event") not in ("payment_link.paid", "payment.captured"):
        return True  # Unknown event — acknowledge without processing

    payload = event.get("payload", {})
    payment_link = payload.get("payment_link", {}).get("entity", {})
    payment      = payload.get("payment", {}).get("entity", {})

    gateway_order_id   = payment_link.get("id") or payment.get("order_id")
    gateway_payment_id = payment.get("id")
    payment_method     = payment.get("method")

    if not gateway_order_id or not gateway_payment_id:
        return True

    await _mark_payment_success(conn, gateway_order_id, gateway_payment_id, payment_method)
    return True


async def handle_phonepe_webhook(
    conn: asyncpg.Connection,
    tenant_slug: str,
    payload_bytes: bytes,
    x_verify: str,
) -> bool:
    tenant = await conn.fetchrow(
        "SELECT feature_flags FROM tenants WHERE slug = $1", tenant_slug
    )
    if not tenant:
        return False

    flags = tenant["feature_flags"] or {}
    salt_key   = flags.get("phonepe_salt_key", "")
    salt_index = int(flags.get("phonepe_salt_index", 1))

    if salt_key:
        data_str = payload_bytes.decode()
        expected_digest = hashlib.sha256(f"{data_str}{salt_key}".encode()).hexdigest()
        expected = f"{expected_digest}###{salt_index}"
        if not hmac.compare_digest(expected, x_verify):
            return False

    try:
        body = json.loads(payload_bytes)
    except json.JSONDecodeError:
        return False

    if body.get("code") != "PAYMENT_SUCCESS":
        return True

    txn = body.get("data", {}).get("paymentInstrument", {})
    gateway_order_id   = body.get("data", {}).get("merchantTransactionId")
    gateway_payment_id = body.get("data", {}).get("transactionId")
    payment_method     = txn.get("type", "").lower()

    if not gateway_order_id or not gateway_payment_id:
        return True

    await _mark_payment_success(conn, gateway_order_id, gateway_payment_id, payment_method)
    return True


# ── Mock Complete (dev only) ──────────────────────────────────────────────────

async def mock_complete_payment(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, payment_id: uuid.UUID
) -> Optional[FeePaymentResponse]:
    row = await conn.fetchrow(
        "SELECT gateway_order_id FROM fee_payments WHERE id = $1 AND tenant_id = $2",
        payment_id, tenant_id,
    )
    if not row or not row["gateway_order_id"]:
        return None
    return await _mark_payment_success(
        conn, row["gateway_order_id"], f"mock_gpay_{payment_id}", "upi"
    )


# ── Status + Receipt ──────────────────────────────────────────────────────────

async def get_payment(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, payment_id: uuid.UUID
) -> Optional[FeePaymentResponse]:
    row = await conn.fetchrow(
        "SELECT * FROM fee_payments WHERE id = $1 AND tenant_id = $2",
        payment_id, tenant_id,
    )
    return FeePaymentResponse(**dict(row)) if row else None


async def get_receipt_html(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, payment_id: uuid.UUID
) -> Optional[str]:
    row = await conn.fetchrow(
        "SELECT receipt_html FROM fee_payments WHERE id = $1 AND tenant_id = $2 AND status = 'paid'",
        payment_id, tenant_id,
    )
    return row["receipt_html"] if row else None


# ── Superadmin ────────────────────────────────────────────────────────────────

async def get_superadmin_revenue(conn: asyncpg.Connection) -> list[dict]:
    rows = await conn.fetch(
        """
        SELECT
            t.id            AS tenant_id,
            t.name          AS school_name,
            t.slug,
            COALESCE(SUM(fp.amount) FILTER (WHERE fp.status = 'paid'), 0)::numeric    AS total_collected,
            COALESCE(SUM(fl.amount_due) FILTER (WHERE fl.status IN ('pending', 'due', 'overdue')), 0)::numeric AS total_outstanding,
            COUNT(fp.id) FILTER (WHERE fp.status = 'paid')::int                       AS payment_count
        FROM tenants t
        LEFT JOIN fee_payments fp ON fp.tenant_id = t.id
        LEFT JOIN fee_ledger fl ON fl.tenant_id = t.id
        WHERE t.slug != 'platform'
        GROUP BY t.id, t.name, t.slug
        ORDER BY total_collected DESC
        """
    )
    return [dict(r) for r in rows]


async def get_superadmin_payment_log(
    conn: asyncpg.Connection, limit: int = 200, offset: int = 0
) -> list[dict]:
    rows = await conn.fetch(
        """
        SELECT
            fp.*,
            t.name AS school_name,
            t.slug AS tenant_slug,
            s.first_name || ' ' || s.last_name AS student_name,
            s.admission_no
        FROM fee_payments fp
        JOIN tenants t ON t.id = fp.tenant_id
        JOIN students s ON s.id = fp.student_id
        WHERE t.slug != 'platform'
        ORDER BY fp.created_at DESC
        LIMIT $1 OFFSET $2
        """,
        limit, offset,
    )
    return [dict(r) for r in rows]
