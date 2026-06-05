from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse

from config import settings
from core.rbac import require_roles
from models.finance import FeePaymentResponse, PaymentOrderCreate, PaymentOrderResponse
from services.payment import (
    PaymentError,
    create_payment_order,
    get_payment,
    get_receipt_html,
    handle_phonepe_webhook,
    handle_razorpay_webhook,
    mock_complete_payment,
)

# No router-level gate: the webhook routes below are JWT-exempt (no user_role on
# request.state). Each authenticated route declares its own guard instead.
router = APIRouter(prefix="/payments", tags=["payments"])

_collect = Depends(require_roles("principal", "accountant"))
_fee_view = Depends(require_roles("principal", "vice_principal", "accountant"))


@router.post(
    "/create-order",
    response_model=PaymentOrderResponse,
    status_code=201,
    dependencies=[_collect],
)
async def create_order(data: PaymentOrderCreate, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        try:
            return await create_payment_order(
                conn,
                tenant_id=request.state.tenant_id,
                tenant_slug=request.state.tenant_slug,
                school_name=request.state.tenant_slug.upper(),
                feature_flags=request.state.feature_flags,
                app_base_url=settings.app_base_url,
                data=data,
            )
        except PaymentError as e:
            raise HTTPException(status_code=400, detail=str(e))


@router.get("/{payment_id}", response_model=FeePaymentResponse, dependencies=[_fee_view])
async def get_status(payment_id: UUID, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        payment = await get_payment(conn, request.state.tenant_id, payment_id)
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    return payment


@router.get(
    "/{payment_id}/receipt", response_class=HTMLResponse, dependencies=[_fee_view]
)
async def get_receipt(payment_id: UUID, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        html = await get_receipt_html(conn, request.state.tenant_id, payment_id)
    if not html:
        raise HTTPException(status_code=404, detail="Receipt not found or payment not yet completed")
    return HTMLResponse(content=html)


# ── Dev-only mock complete ────────────────────────────────────────────────────

@router.post(
    "/{payment_id}/mock-complete",
    response_model=FeePaymentResponse,
    dependencies=[_collect],
)
async def mock_complete(payment_id: UUID, request: Request):
    if not settings.debug:
        raise HTTPException(status_code=404)
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        result = await mock_complete_payment(conn, request.state.tenant_id, payment_id)
    if not result:
        raise HTTPException(status_code=404, detail="Payment not found")
    return result


# ── Webhooks (no JWT auth — HMAC verified inside handler) ────────────────────

@router.post("/webhooks/razorpay/{tenant_slug}")
async def razorpay_webhook(tenant_slug: str, request: Request):
    body = await request.body()
    signature = request.headers.get("x-razorpay-signature", "")
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        ok = await handle_razorpay_webhook(conn, tenant_slug, body, signature)
    if not ok:
        raise HTTPException(status_code=400, detail="Webhook verification failed")
    return {"status": "ok"}


@router.post("/webhooks/phonepe/{tenant_slug}")
async def phonepe_webhook(tenant_slug: str, request: Request):
    body = await request.body()
    x_verify = request.headers.get("x-verify", "")
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        ok = await handle_phonepe_webhook(conn, tenant_slug, body, x_verify)
    if not ok:
        raise HTTPException(status_code=400, detail="Webhook verification failed")
    return {"status": "ok"}
