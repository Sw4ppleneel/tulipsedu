from datetime import date, datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


# ── Exam Subjects ─────────────────────────────────────────────────────────────

class ExamSubjectCreate(BaseModel):
    academic_year_id: UUID
    class_id: UUID
    name: str
    subject_code: Optional[str] = None
    sort_order: int = 0


class ExamSubjectResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    academic_year_id: UUID
    class_id: UUID
    name: str
    subject_code: Optional[str]
    sort_order: int
    is_active: bool
    created_at: datetime


# ── Exam Terms ────────────────────────────────────────────────────────────────

class ExamTermCreate(BaseModel):
    academic_year_id: UUID
    name: str
    term_type: str
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    sort_order: int = 0


class ExamTermResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    academic_year_id: UUID
    name: str
    term_type: str
    start_date: Optional[date]
    end_date: Optional[date]
    is_published: bool
    status: str
    sort_order: int
    created_at: datetime


class TermStatusRequest(BaseModel):
    status: str  # marks_open | locked | published


# ── Marks Config ──────────────────────────────────────────────────────────────

class MarksConfigCreate(BaseModel):
    exam_term_id: UUID
    exam_subject_id: UUID
    max_marks: Decimal = Field(gt=0)
    passing_marks: Decimal = Field(default=Decimal("33"), ge=0)
    weightage: Decimal = Field(default=Decimal("100"), gt=0)


class MarksConfigResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    exam_term_id: UUID
    exam_subject_id: UUID
    subject_name: Optional[str] = None
    max_marks: Decimal
    passing_marks: Decimal
    weightage: Decimal
    created_at: datetime


# ── Mark Entries ──────────────────────────────────────────────────────────────

class MarkEntryItem(BaseModel):
    student_id: UUID
    exam_subject_id: UUID
    marks_obtained: Optional[Decimal] = None
    is_absent: bool = False
    remarks: Optional[str] = None


class BulkMarkRequest(BaseModel):
    exam_term_id: UUID
    entries: list[MarkEntryItem]


class MarkEntryResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    student_id: UUID
    exam_term_id: UUID
    exam_subject_id: UUID
    marks_obtained: Optional[Decimal]
    is_absent: bool
    remarks: Optional[str]
    entered_by: Optional[UUID]
    created_at: datetime
    updated_at: datetime


# ── Exam Components (term × subject breakdown) ───────────────────────────────

class ExamComponentCreate(BaseModel):
    name: str
    max_marks: Decimal = Field(gt=0)
    sort_order: int = 0


class ConfigureComponentsRequest(BaseModel):
    exam_term_id: UUID
    exam_subject_id: UUID
    components: list[ExamComponentCreate]


class ExamComponentResponse(BaseModel):
    id: UUID
    name: str
    max_marks: Decimal
    sort_order: int


class ComponentMarkItem(BaseModel):
    student_id: UUID
    exam_component_id: UUID
    marks_obtained: Optional[Decimal] = None
    is_absent: bool = False


class SaveComponentMarksRequest(BaseModel):
    exam_term_id: UUID
    exam_subject_id: UUID
    entries: list[ComponentMarkItem]


class StudentComponentRow(BaseModel):
    student_id: UUID
    roll_number: str
    student_name: str
    marks: dict[str, Optional[float]]   # keyed by exam_component_id (str)
    is_absent: bool
    total: Optional[float]


class ComponentMarksGrid(BaseModel):
    exam_term_id: UUID
    exam_subject_id: UUID
    components: list[ExamComponentResponse]
    total_max: Decimal
    students: list[StudentComponentRow]


# ── Results ───────────────────────────────────────────────────────────────────

class SubjectResult(BaseModel):
    subject_id: UUID
    subject_name: str
    max_marks: Decimal
    marks_obtained: Optional[Decimal]
    is_absent: bool
    percentage: Optional[float]
    grade: str
    passed: bool


class StudentTermResult(BaseModel):
    student_id: UUID
    roll_number: str
    admission_no: str
    student_name: str
    subjects: list[SubjectResult]
    total_obtained: Decimal
    total_max: Decimal
    percentage: Optional[float]
    grade: str
    passed: bool


class TermResultSheet(BaseModel):
    exam_term_id: UUID
    exam_term_name: str
    class_id: UUID
    section_id: UUID
    results: list[StudentTermResult]


class ConsolidatedSubject(BaseModel):
    subject_id: UUID
    subject_name: str
    terms: list[dict]         # [{term_name, marks, max_marks, weightage}]
    weighted_percentage: Optional[float]
    grade: str
    passed: bool


class ConsolidatedResult(BaseModel):
    student_id: UUID
    roll_number: str
    admission_no: str
    student_name: str
    subjects: list[ConsolidatedSubject]
    overall_percentage: Optional[float]
    overall_grade: str
    passed: bool
