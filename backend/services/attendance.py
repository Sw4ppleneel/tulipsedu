import uuid
from datetime import date, datetime
from typing import Optional
from zoneinfo import ZoneInfo

import asyncpg

from core.events import emit
from models.attendance import (
    AttendanceMark,
    AttendanceRecord,
    AttendanceReport,
    AttendanceSession,
    MarkRequest,
    SessionCreate,
    SessionDetail,
    StudentAttendanceSummary,
)


class AttendanceError(Exception):
    pass


class AttendanceLocked(AttendanceError):
    """Edit attempted on a day-locked session by a non-override role."""


# Indian K-12 daily attendance: a session is editable only on its own calendar
# day (school-local time). It locks at the start of the next IST day; after that
# only principal/admin may edit, and each such edit emits ATTENDANCE_OVERRIDE.
_IST = ZoneInfo("Asia/Kolkata")


def _today_ist() -> date:
    return datetime.now(_IST).date()


def is_locked(session_date: date) -> bool:
    return _today_ist() > session_date


def _with_lock(row: dict) -> dict:
    row["locked"] = is_locked(row["date"])
    return row


_SESSION_JOIN = """
    SELECT
        sess.*,
        c.name   AS class_name,
        sec.name AS section_name,
        ay.name  AS academic_year_name,
        CASE
            WHEN sess.marked_by IS NULL THEN NULL
            ELSE COALESCE(st.first_name, 'Staff')
        END AS marked_by_name
    FROM attendance_sessions sess
    JOIN classes        c   ON c.id   = sess.class_id
    JOIN sections       sec ON sec.id = sess.section_id
    JOIN academic_years ay  ON ay.id  = sess.academic_year_id
    LEFT JOIN users     u   ON u.id   = sess.marked_by
    LEFT JOIN staff     st  ON st.user_id = u.id AND st.tenant_id = sess.tenant_id
"""


async def get_or_create_session(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    data: SessionCreate,
) -> tuple[AttendanceSession, bool]:
    row = await conn.fetchrow(
        f"{_SESSION_JOIN} WHERE sess.tenant_id = $1 AND sess.academic_year_id = $2 "
        f"AND sess.class_id = $3 AND sess.section_id = $4 AND sess.date = $5",
        tenant_id, data.academic_year_id, data.class_id, data.section_id, data.date,
    )
    if row:
        return AttendanceSession(**_with_lock(dict(row))), False

    new_row = await conn.fetchrow(
        """
        INSERT INTO attendance_sessions
            (tenant_id, academic_year_id, class_id, section_id, date, marked_by)
        VALUES ($1,$2,$3,$4,$5,$6)
        RETURNING *
        """,
        tenant_id, data.academic_year_id, data.class_id, data.section_id, data.date, user_id,
    )
    full = await conn.fetchrow(
        f"{_SESSION_JOIN} WHERE sess.id = $1", new_row["id"]
    )
    return AttendanceSession(**_with_lock(dict(full))), True


async def get_session_scope(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, session_id: uuid.UUID
) -> Optional[tuple[uuid.UUID, uuid.UUID]]:
    """(class_id, section_id) for scope checks, or None if the session is absent."""
    row = await conn.fetchrow(
        "SELECT class_id, section_id FROM attendance_sessions WHERE id = $1 AND tenant_id = $2",
        session_id, tenant_id,
    )
    return (row["class_id"], row["section_id"]) if row else None


async def get_session_detail(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, session_id: uuid.UUID
) -> Optional[SessionDetail]:
    row = await conn.fetchrow(
        f"{_SESSION_JOIN} WHERE sess.id = $1 AND sess.tenant_id = $2",
        session_id, tenant_id,
    )
    if not row:
        return None

    records = await conn.fetch(
        "SELECT * FROM attendance_records WHERE session_id = $1 AND tenant_id = $2",
        session_id, tenant_id,
    )
    return SessionDetail(
        session=AttendanceSession(**_with_lock(dict(row))),
        records=[AttendanceRecord(**dict(r)) for r in records],
    )


async def list_sessions(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    academic_year_id: Optional[uuid.UUID] = None,
    class_id: Optional[uuid.UUID] = None,
    section_id: Optional[uuid.UUID] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    limit: int = 60,
    offset: int = 0,
) -> list[AttendanceSession]:
    where = """
        WHERE sess.tenant_id = $1
          AND ($2::uuid    IS NULL OR sess.academic_year_id = $2::uuid)
          AND ($3::uuid    IS NULL OR sess.class_id         = $3::uuid)
          AND ($4::uuid    IS NULL OR sess.section_id       = $4::uuid)
          AND ($5::date    IS NULL OR sess.date             >= $5::date)
          AND ($6::date    IS NULL OR sess.date             <= $6::date)
    """
    rows = await conn.fetch(
        f"{_SESSION_JOIN} {where} ORDER BY sess.date DESC LIMIT $7 OFFSET $8",
        tenant_id, academic_year_id, class_id, section_id, from_date, to_date, limit, offset,
    )
    return [AttendanceSession(**_with_lock(dict(r))) for r in rows]


async def mark_attendance(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    session_id: uuid.UUID,
    req: MarkRequest,
    *,
    can_override: bool = False,
) -> int:
    session = await conn.fetchrow(
        "SELECT id, submitted, date FROM attendance_sessions WHERE id = $1 AND tenant_id = $2",
        session_id, tenant_id,
    )
    if not session:
        raise AttendanceError("Session not found")

    locked = is_locked(session["date"])
    if locked and not can_override:
        raise AttendanceLocked(
            f"Attendance for {session['date']} is locked; only a principal can edit it."
        )

    if not req.marks:
        return 0

    student_ids = [m.student_id for m in req.marks]
    statuses = [m.status for m in req.marks]

    # Records + event must land atomically — the worker consumes the event.
    async with conn.transaction():
        await conn.execute(
            """
            INSERT INTO attendance_records (tenant_id, session_id, student_id, status)
            SELECT $1, $2, UNNEST($3::uuid[]), UNNEST($4::char[])
            ON CONFLICT (tenant_id, session_id, student_id)
            DO UPDATE SET status = EXCLUDED.status
            """,
            tenant_id, session_id, student_ids, statuses,
        )

        # A post-lock admin edit is an override (immutable audit); an edit to a
        # submitted-but-unlocked session is a correction; otherwise a fresh mark.
        if locked:
            event = "ATTENDANCE_OVERRIDE"
        elif session["submitted"]:
            event = "ATTENDANCE_CORRECTED"
        else:
            event = "ATTENDANCE_MARKED"
        await emit(conn, event, tenant_id, {
            "session_id": str(session_id),
            "count": len(req.marks),
        })
    return len(req.marks)


async def submit_session(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    session_id: uuid.UUID,
    *,
    can_override: bool = False,
) -> Optional[AttendanceSession]:
    row = await conn.fetchrow(
        f"{_SESSION_JOIN} WHERE sess.id = $1 AND sess.tenant_id = $2",
        session_id, tenant_id,
    )
    if not row:
        return None

    if is_locked(row["date"]) and not can_override:
        raise AttendanceLocked(
            f"Attendance for {row['date']} is locked; only a principal can edit it."
        )

    # Submit flag + event must land atomically — the event triggers absent alerts.
    async with conn.transaction():
        await conn.execute(
            "UPDATE attendance_sessions SET submitted = TRUE WHERE id = $1 AND tenant_id = $2",
            session_id, tenant_id,
        )
        await emit(conn, "ATTENDANCE_SESSION_SUBMITTED", tenant_id, {
            "session_id": str(session_id),
        })
    updated = _with_lock(dict(row))
    updated["submitted"] = True
    return AttendanceSession(**updated)


async def get_attendance_report(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    academic_year_id: uuid.UUID,
    class_id: uuid.UUID,
    section_id: uuid.UUID,
    from_date: date,
    to_date: date,
) -> AttendanceReport:
    total_sessions: int = await conn.fetchval(
        """
        SELECT COUNT(*) FROM attendance_sessions
        WHERE tenant_id = $1 AND academic_year_id = $2
          AND class_id = $3 AND section_id = $4
          AND date >= $5 AND date <= $6
        """,
        tenant_id, academic_year_id, class_id, section_id, from_date, to_date,
    )

    rows = await conn.fetch(
        """
        SELECT
            s.id            AS student_id,
            s.first_name,
            s.last_name,
            s.roll_number,
            s.admission_no,
            COUNT(ar.id)                                             AS total_marked,
            SUM(CASE WHEN ar.status = 'P' THEN 1 ELSE 0 END)::int   AS present,
            SUM(CASE WHEN ar.status = 'A' THEN 1 ELSE 0 END)::int   AS absent,
            SUM(CASE WHEN ar.status = 'L' THEN 1 ELSE 0 END)::int   AS late
        FROM students s
        LEFT JOIN attendance_records ar ON ar.student_id = s.id AND ar.tenant_id = s.tenant_id
        LEFT JOIN attendance_sessions sess ON sess.id = ar.session_id
            AND sess.date >= $5 AND sess.date <= $6
        WHERE s.tenant_id = $1 AND s.academic_year_id = $2
          AND s.class_id = $3 AND s.section_id = $4
          AND s.is_active = TRUE
        GROUP BY s.id, s.first_name, s.last_name, s.roll_number, s.admission_no
        ORDER BY
            CASE WHEN s.roll_number ~ '^[0-9]+$' THEN LPAD(s.roll_number, 10, '0') ELSE s.roll_number END
        """,
        tenant_id, academic_year_id, class_id, section_id, from_date, to_date,
    )

    students = []
    for r in rows:
        present = r["present"] or 0
        late = r["late"] or 0
        pct = round((present + late) / total_sessions * 100, 1) if total_sessions else 0.0
        students.append(StudentAttendanceSummary(
            student_id=r["student_id"],
            first_name=r["first_name"],
            last_name=r["last_name"],
            roll_number=r["roll_number"],
            admission_no=r["admission_no"],
            total_sessions=total_sessions,
            present=present,
            absent=r["absent"] or 0,
            late=late,
            percentage=pct,
        ))

    return AttendanceReport(
        class_id=class_id,
        section_id=section_id,
        academic_year_id=academic_year_id,
        from_date=from_date,
        to_date=to_date,
        total_sessions=total_sessions,
        students=students,
    )
