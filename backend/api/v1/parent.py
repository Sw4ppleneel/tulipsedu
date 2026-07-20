import uuid

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response

from models.exam import TermResultSheet
from models.timetable import WeeklyTimetable
from models.finance import ParentPaymentClaim, ParentPaymentRow
from models.notification import NotificationResponse, UnreadCount
from models.parent import FeeLedgerEntry, LinkedStudent, StudentSummary
from services import parent_payment
from services.exam import ExamError, compute_term_results
from services import timetable as timetable_svc
from services.notification import (
    list_for_recipient,
    mark_all_read,
    mark_read,
    unread_count,
)
from models.parent import ParentPasswordChange
from services.parent import (
    ParentAuthError,
    change_portal_password,
    get_fee_ledger_entries,
    get_student_basic,
    get_student_summary_by_id,
)
from services.report_card import build_report_card_context
from services.report_card_pdf import render_report_card_pdf

router = APIRouter(prefix="/parent", tags=["Parent Portal"])


def _require_parent(request: Request) -> uuid.UUID:
    """Returns the student_id the JWT is scoped to (admission-number session)."""
    if "parent" not in getattr(request.state, "user_roles", frozenset()):
        raise HTTPException(status_code=403, detail="Parent access only")
    return uuid.UUID(request.state.user_id)


@router.put("/password")
async def parent_change_password(body: ParentPasswordChange, request: Request):
    """Self-service portal password change; requires the current password
    (stored hash, or the last-4-of-phone default while none is set)."""
    student_id = _require_parent(request)
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        try:
            await change_portal_password(
                conn, request.state.tenant_id, student_id,
                body.current_password, body.new_password,
            )
        except ParentAuthError as e:
            raise HTTPException(status_code=400, detail=str(e))
    return {"detail": "Password changed"}


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


# ── Results / Report Card ─────────────────────────────────────────────────────

@router.get("/students/{student_id}/results", response_model=list[TermResultSheet])
async def student_results(student_id: uuid.UUID, request: Request):
    """
    Returns the grade sheet for every published exam term for this student.
    Only the student's own parent session may call this.
    """
    session_student = _require_parent(request)
    if student_id != session_student:
        raise HTTPException(status_code=403, detail="Not permitted for this student")

    tid = request.state.tenant_id
    pool = request.app.state.pool

    async with pool.acquire() as conn:
        # Get student's class + section so we can fetch the right marks grid
        row = await conn.fetchrow(
            "SELECT class_id, section_id FROM students WHERE id = $1 AND tenant_id = $2",
            student_id, tid,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Student not found")

        # All published terms for this academic year (scoped to the student's tenant)
        terms = await conn.fetch(
            """
            SELECT et.id, et.name
            FROM exam_terms et
            WHERE et.tenant_id = $1
              AND et.is_published = TRUE
            ORDER BY et.created_at
            """,
            tid,
        )

        sheets: list[TermResultSheet] = []
        for term in terms:
            try:
                sheet = await compute_term_results(
                    conn, tid, term["id"],
                    row["class_id"], row["section_id"],
                )
                # Only include if this student actually has marks in this term
                this_student = next(
                    (r for r in sheet.results if r.student_id == student_id), None
                )
                if this_student is not None:
                    # Return a sheet with only this student's row
                    sheets.append(TermResultSheet(
                        exam_term_id=sheet.exam_term_id,
                        exam_term_name=sheet.exam_term_name,
                        class_id=sheet.class_id,
                        section_id=sheet.section_id,
                        results=[this_student],
                    ))
            except ExamError:
                pass  # term not configured for this class yet

    return sheets


@router.get("/students/{student_id}/timetable", response_model=WeeklyTimetable)
async def student_timetable(student_id: uuid.UUID, request: Request):
    """Return the weekly timetable for the student's class/section (current academic year)."""
    session_student = _require_parent(request)
    if student_id != session_student:
        raise HTTPException(status_code=403, detail="Not permitted for this student")
    tid = request.state.tenant_id
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT class_id, section_id FROM students WHERE id = $1 AND tenant_id = $2",
            student_id, tid,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Student not found")
        ay = await conn.fetchrow(
            "SELECT id FROM academic_years WHERE tenant_id = $1 AND is_current = TRUE LIMIT 1",
            tid,
        )
        if not ay:
            raise HTTPException(status_code=404, detail="No current academic year")
        return await timetable_svc.get_weekly_timetable(
            conn, tid, ay["id"], row["class_id"], row["section_id"]
        )


@router.get("/students/{student_id}/results/report-card.pdf")
async def student_report_card_pdf(
    student_id: uuid.UUID, request: Request, exam_term_id: uuid.UUID = Query(...)
):
    """Downloadable report-card PDF for the parent's own child — published terms only."""
    session_student = _require_parent(request)
    if student_id != session_student:
        raise HTTPException(status_code=403, detail="Not permitted for this student")
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        ctx = await build_report_card_context(
            conn, request.state.tenant_id, exam_term_id, student_id, require_published=True
        )
    if not ctx:
        raise HTTPException(404, "Report card not available")
    pdf = render_report_card_pdf(ctx)
    filename = f"report-card-{ctx['admission_no']}-{ctx['term_name']}.pdf".replace(" ", "_")
    return Response(
        content=pdf, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
