from datetime import date
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request

from core.csv_export import csv_response, require_export_role
from models.attendance import (
    AttendanceReport,
    AttendanceSession,
    MarkRequest,
    SessionCreate,
    SessionDetail,
)
from services.attendance import (
    AttendanceError,
    get_attendance_report,
    get_or_create_session,
    get_session_detail,
    list_sessions,
    mark_attendance,
    submit_session,
)

router = APIRouter(prefix="/attendance", tags=["attendance"])


@router.post("/sessions", response_model=AttendanceSession, status_code=200)
async def open_session(data: SessionCreate, request: Request):
    """Get existing session for the date or create a new one."""
    user_id = UUID(request.state.user_id)
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        session, _ = await get_or_create_session(
            conn, request.state.tenant_id, user_id, data
        )
    return session


@router.get("/sessions", response_model=list[AttendanceSession])
async def get_sessions(
    request: Request,
    academic_year_id: Optional[UUID] = Query(None),
    class_id: Optional[UUID] = Query(None),
    section_id: Optional[UUID] = Query(None),
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    limit: int = Query(60, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await list_sessions(
            conn, request.state.tenant_id,
            academic_year_id=academic_year_id,
            class_id=class_id, section_id=section_id,
            from_date=from_date, to_date=to_date,
            limit=limit, offset=offset,
        )


@router.get("/sessions/{session_id}", response_model=SessionDetail)
async def get_session(session_id: UUID, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        detail = await get_session_detail(conn, request.state.tenant_id, session_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Session not found")
    return detail


@router.post("/sessions/{session_id}/mark", status_code=200)
async def mark(session_id: UUID, req: MarkRequest, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        try:
            count = await mark_attendance(conn, request.state.tenant_id, session_id, req)
        except AttendanceError as e:
            raise HTTPException(status_code=404, detail=str(e))
    return {"marked": count}


@router.post("/sessions/{session_id}/submit", response_model=AttendanceSession)
async def submit(session_id: UUID, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        session = await submit_session(conn, request.state.tenant_id, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.get("/report", response_model=AttendanceReport)
async def report(
    request: Request,
    academic_year_id: UUID = Query(...),
    class_id: UUID = Query(...),
    section_id: UUID = Query(...),
    from_date: date = Query(...),
    to_date: date = Query(...),
):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await get_attendance_report(
            conn, request.state.tenant_id,
            academic_year_id, class_id, section_id, from_date, to_date,
        )


@router.get("/export.csv")
async def export_attendance_csv(
    request: Request,
    academic_year_id: UUID = Query(...),
    class_id: UUID = Query(...),
    section_id: UUID = Query(...),
    from_date: date = Query(...),
    to_date: date = Query(...),
):
    require_export_role(request)
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        report_data = await get_attendance_report(
            conn, request.state.tenant_id,
            academic_year_id, class_id, section_id, from_date, to_date,
        )
        # Fetch session dates for the header context
        sessions = await conn.fetch(
            """
            SELECT date FROM attendance_sessions
            WHERE tenant_id = $1 AND academic_year_id = $2
              AND class_id = $3 AND section_id = $4
              AND date >= $5 AND date <= $6
            ORDER BY date
            """,
            request.state.tenant_id,
            academic_year_id, class_id, section_id, from_date, to_date,
        )
        # Per-date records for full grid
        records = await conn.fetch(
            """
            SELECT ar.student_id, sess.date, ar.status
            FROM attendance_records ar
            JOIN attendance_sessions sess ON sess.id = ar.session_id
            WHERE ar.tenant_id = $1 AND sess.academic_year_id = $2
              AND sess.class_id = $3 AND sess.section_id = $4
              AND sess.date >= $5 AND sess.date <= $6
            """,
            request.state.tenant_id,
            academic_year_id, class_id, section_id, from_date, to_date,
        )

    session_dates = [str(r["date"]) for r in sessions]
    # Build lookup: {student_id: {date: status}}
    by_student: dict = {}
    for r in records:
        sid = str(r["student_id"])
        by_student.setdefault(sid, {})[str(r["date"])] = r["status"]

    headers = ["Roll No", "Admission No", "Name", *session_dates, "Present", "Absent", "Late", "%"]
    rows = []
    for s in report_data.students:
        daily = [by_student.get(str(s.student_id), {}).get(d, "-") for d in session_dates]
        rows.append([
            s.roll_number, s.admission_no, f"{s.first_name} {s.last_name}",
            *daily, s.present, s.absent, s.late, s.percentage,
        ])
    return csv_response(headers, rows, "attendance.csv")
