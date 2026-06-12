import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class OTPRequest(BaseModel):
    phone_number: str


class OTPVerify(BaseModel):
    phone_number: str
    otp: str


class AdmissionLoginRequest(BaseModel):
    admission_no: str


class ParentTokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    student_id: Optional[uuid.UUID] = None
    student_name: Optional[str] = None
    dev_otp: Optional[str] = None  # returned only when debug=True


class LinkedStudent(BaseModel):
    id: uuid.UUID
    first_name: str
    last_name: str
    admission_no: str
    roll_number: int
    class_name: str
    section_name: str
    class_id: uuid.UUID
    section_id: uuid.UUID
    academic_year_id: uuid.UUID
    relationship: str


class AttendanceSummary(BaseModel):
    total_sessions: int
    present: int
    absent: int
    late: int
    percentage: float


class FeeLedgerEntry(BaseModel):
    id: uuid.UUID
    fee_head_name: str
    period_month: Optional[int]   # None = annual / one-time
    period_year: int
    amount_due: float
    status: str                   # pending | paid | overdue


class FeeAssignment(BaseModel):
    structure_name: str
    total_amount: float
    paid_amount: float
    balance: float
    status: str


class RecentPayment(BaseModel):
    amount: float
    payment_method: str
    reference_no: Optional[str]
    created_at: datetime


class FeeSummary(BaseModel):
    assignments: list[FeeAssignment]
    recent_payments: list[RecentPayment]
    total_balance: float


class HomeworkItem(BaseModel):
    id: uuid.UUID
    subject: str
    post_type: str
    title: str
    description: Optional[str]
    due_date: Optional[str]
    created_at: datetime


class StudentSummary(BaseModel):
    student: LinkedStudent
    attendance: AttendanceSummary
    fees: FeeSummary
    recent_homework: list[HomeworkItem]
    school_name: str
    school_upi_id: Optional[str] = None  # school VPA for UPI QR; None = not configured
