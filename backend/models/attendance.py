from datetime import date, datetime
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel


class SessionCreate(BaseModel):
    academic_year_id: UUID
    class_id: UUID
    section_id: UUID
    date: date


class AttendanceMark(BaseModel):
    student_id: UUID
    status: Literal["P", "A", "L"]


class MarkRequest(BaseModel):
    marks: list[AttendanceMark]


class AttendanceSession(BaseModel):
    id: UUID
    tenant_id: UUID
    academic_year_id: UUID
    class_id: UUID
    section_id: UUID
    date: date
    marked_by: UUID
    submitted: bool
    locked: bool = False  # day-locked (past its IST calendar day) — admin-only edits
    created_at: datetime
    class_name: Optional[str] = None
    section_name: Optional[str] = None
    academic_year_name: Optional[str] = None
    marked_by_name: Optional[str] = None


class AttendanceRecord(BaseModel):
    id: UUID
    tenant_id: UUID
    session_id: UUID
    student_id: UUID
    status: str
    created_at: datetime


class SessionDetail(BaseModel):
    session: AttendanceSession
    records: list[AttendanceRecord]


class StudentAttendanceSummary(BaseModel):
    student_id: UUID
    first_name: str
    last_name: str
    roll_number: str
    admission_no: str
    total_sessions: int
    present: int
    absent: int
    late: int
    percentage: float


class AttendanceReport(BaseModel):
    class_id: UUID
    section_id: UUID
    academic_year_id: UUID
    from_date: date
    to_date: date
    total_sessions: int
    students: list[StudentAttendanceSummary]
