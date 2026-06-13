import uuid

from fastapi import APIRouter, HTTPException, Query, Request

from models.finance import ParentPaymentClaim, ParentPaymentRow
from models.notification import NotificationResponse, UnreadCount
from models.parent import FeeLedgerEntry, LinkedStudent, StudentSummary
from services.notification import (
    list_for_recipient,
    mark_all_read,
    mark_read,
    unread_count,
)
from services.parent import get_fee_ledger_entries, get_student_basic, get_student_summary_by_id
from services import parent_payment

router = APIRouter(prefix="/parent", tags=["Parent Portal"])


def _require_parent(request: Request) -> uuid.UUID:
    """Returns the student_id the JWT is scoped to (admission-number session)."""
    if getattr(request.state, "user_role", None) != "parent":
        raise HTTPException(status_code=403, detail="Parent access only")
    return uuid.UUID(request.state.user_id)


@router.get("/students", response_model=list[LinkedStudent])
async def list_my_students(request: Request):
    student_id = _require_parent(request)
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        student = await get_student_basic(conn, request.state.tenant_id, student_id)
    return [student] if student else []


@router.get("/students/{student_id}/ledger", response_model=list[FeeLedgerEntry])
async def student_ledger(student_id: uuid.UUID, request: Request):
    session_student = _require_parent(request)
    if student_id != session_student:
        raise HTTPException(status_code=403, detail="Not permitted for this student")
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await get_fee_ledger_entries(conn, request.state.tenant_id, student_id)


@router.post("/payments", status_code=201)
async def claim_payment(body: ParentPaymentClaim, request: Request):
    """Parent marks selected pending fees as paid via UPI (awaiting verification)."""
    student_id = _require_parent(request)
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        try:
            pid = await parent_payment.submit_claim(
                conn, request.state.tenant_id, student_id, body.ledger_ids, body.reference_no,
            )
        except parent_payment.ParentPaymentError as e:
            raise HTTPException(status_code=400, detail=str(e))
    return {"payment_id": str(pid), "status": "pending_verification"}


@router.get("/payments", response_model=list[ParentPaymentRow])
async def my_payments(request: Request):
    student_id = _require_parent(request)
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await parent_payment.list_for_student(conn, request.state.tenant_id, student_id)


@router.get("/students/{student_id}/summary", response_model=StudentSummary)
async def student_summary(student_id: uuid.UUID, request: Request):
    session_student = _require_parent(request)
    # A session may only read its own student.
    if student_id != session_student:
        raise HTTPException(status_code=403, detail="Not permitted for this student")
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        result = await get_student_summary_by_id(
            conn, request.state.tenant_id, student_id
        )
    if not result:
        raise HTTPException(status_code=404, detail="Student not found")
    return result


# ── Notifications (recipient = the session's student) ────────────────────────

@router.get("/notifications", response_model=list[NotificationResponse])
async def parent_notifications(
    request: Request,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    student_id = _require_parent(request)
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await list_for_recipient(
            conn, request.state.tenant_id, "parent_of_student", student_id,
            limit=limit, offset=offset,
        )


@router.get("/notifications/unread-count", response_model=UnreadCount)
async def parent_unread_count(request: Request):
    student_id = _require_parent(request)
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        n = await unread_count(
            conn, request.state.tenant_id, "parent_of_student", student_id
        )
    return UnreadCount(unread=n)


@router.post("/notifications/read-all", response_model=UnreadCount)
async def parent_read_all(request: Request):
    student_id = _require_parent(request)
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        await mark_all_read(
            conn, request.state.tenant_id, "parent_of_student", student_id
        )
    return UnreadCount(unread=0)


@router.post("/notifications/{notification_id}/read", status_code=204)
async def parent_read_one(notification_id: uuid.UUID, request: Request):
    student_id = _require_parent(request)
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        ok = await mark_read(
            conn, request.state.tenant_id, "parent_of_student", student_id,
            notification_id,
        )
    if not ok:
        raise HTTPException(status_code=404, detail="Notification not found")
