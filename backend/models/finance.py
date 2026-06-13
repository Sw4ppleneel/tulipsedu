from datetime import datetime
from decimal import Decimal
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field


# ── Parent self-reported UPI payments (migration 025) ────────────────────────

class ParentPaymentClaim(BaseModel):
    ledger_ids: list[UUID] = Field(min_length=1)
    reference_no: Optional[str] = None  # UPI UTR, optional


class ParentPaymentRow(BaseModel):
    id: UUID
    amount: Decimal
    status: str
    reference_no: Optional[str] = None
    receipt_number: Optional[str] = None
    rejection_reason: Optional[str] = None
    periods: str = ""
    created_at: datetime
    paid_at: Optional[datetime] = None


class PendingPaymentRow(BaseModel):
    id: UUID
    amount: Decimal
    reference_no: Optional[str] = None
    first_name: str
    last_name: str
    admission_no: str
    class_name: str
    section_name: str
    periods: str = ""
    created_at: datetime


class RejectRequest(BaseModel):
    reason: str = ""


class OfflineCollectRequest(BaseModel):
    student_id: UUID
    ledger_ids: list[UUID] = Field(min_length=1)
    method: Literal["cash", "cheque", "upi", "bank_transfer", "card"] = "cash"
    reference_no: Optional[str] = None


# ── Fee Heads ────────────────────────────────────────────────────────────────

class FeeHeadCreate(BaseModel):
    name: str
    fee_type: Literal["monthly", "annual", "one_time"]
    sort_order: int = 0


class FeeHeadResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    name: str
    fee_type: str
    sort_order: int
    is_active: bool
    created_at: datetime


# ── Fee Schedules ─────────────────────────────────────────────────────────────

class FeeScheduleCreate(BaseModel):
    fee_head_id: UUID
    academic_year_id: UUID
    class_id: Optional[UUID] = None
    amount: Decimal = Field(gt=0)
    due_day_of_month: int = Field(default=10, ge=1, le=28)


class FeeScheduleResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    fee_head_id: UUID
    fee_head_name: Optional[str] = None
    fee_type: Optional[str] = None
    academic_year_id: UUID
    class_id: Optional[UUID]
    class_name: Optional[str] = None
    amount: Decimal
    due_day_of_month: int
    created_at: datetime


# ── Fee Ledger ────────────────────────────────────────────────────────────────

class MonthYearPair(BaseModel):
    month: int = Field(ge=1, le=12)
    year: int = Field(ge=2000, le=2100)


class GenerateLedgerRequest(BaseModel):
    academic_year_id: UUID
    month_year_pairs: list[MonthYearPair]
    include_annual: bool = True


class LedgerEntry(BaseModel):
    id: UUID
    tenant_id: UUID
    student_id: UUID
    fee_head_id: UUID
    fee_head_name: Optional[str] = None
    fee_type: Optional[str] = None
    academic_year_id: UUID
    period_month: Optional[int]
    period_year: int
    amount_due: Decimal
    status: str
    payment_id: Optional[UUID]
    created_at: datetime


class StudentLedger(BaseModel):
    student_id: UUID
    student_name: str
    admission_no: str
    class_section: str
    pending: list[LedgerEntry]
    paid: list[LedgerEntry]
    total_pending: Decimal
    total_paid: Decimal


class OutstandingStudent(BaseModel):
    student_id: UUID
    student_name: str
    admission_no: str
    roll_number: str
    class_name: str
    section_name: str
    total_due: Decimal
    pending_entries: int


class OutstandingReport(BaseModel):
    items: list[OutstandingStudent]
    grand_total: Decimal
    student_count: int


# ── Payments ──────────────────────────────────────────────────────────────────

class PaymentOrderCreate(BaseModel):
    student_id: UUID
    ledger_ids: list[UUID] = Field(min_length=1)
    gateway: Literal["razorpay", "phonepe", "mock"]


class BreakdownItem(BaseModel):
    description: str
    amount: Decimal


class PaymentOrderResponse(BaseModel):
    payment_id: UUID
    payment_ref: str
    gateway: str
    gateway_order_id: Optional[str]
    payment_url: Optional[str]
    qr_url: Optional[str]
    amount: Decimal
    currency: str
    status: str
    breakdown: list[BreakdownItem]
    created_at: datetime


class FeePaymentResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    student_id: UUID
    payment_ref: str
    gateway: str
    gateway_order_id: Optional[str]
    gateway_payment_id: Optional[str]
    amount: Decimal
    status: str
    payment_method: Optional[str]
    receipt_number: Optional[str]
    paid_at: Optional[datetime]
    created_at: datetime


# ── Superadmin ────────────────────────────────────────────────────────────────

class TenantRevenueSummary(BaseModel):
    tenant_id: UUID
    school_name: str
    slug: str
    total_collected: Decimal
    total_outstanding: Decimal
    payment_count: int


class SuperadminPaymentRow(BaseModel):
    id: UUID
    school_name: str
    tenant_slug: str
    student_name: str
    admission_no: str
    amount: Decimal
    status: str
    gateway: str
    payment_method: Optional[str]
    receipt_number: Optional[str]
    paid_at: Optional[datetime]
    created_at: datetime
