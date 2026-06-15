from datetime import date, datetime
from decimal import Decimal
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class SalaryComponent(BaseModel):
    """A recurring monthly line on a salary structure."""
    name: str = Field(min_length=1, max_length=60)
    type: Literal["allowance", "deduction"]
    amount: Decimal = Field(ge=0, max_digits=12, decimal_places=2)


class PayslipLine(BaseModel):
    """A one-off allowance/deduction line on a single payslip."""
    name: str = Field(min_length=1, max_length=60)
    amount: Decimal = Field(ge=0, max_digits=12, decimal_places=2)


class SalaryStructureUpsert(BaseModel):
    gross_salary: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    components: list[SalaryComponent] = []
    effective_from: Optional[date] = None


class SalaryStructureResponse(BaseModel):
    id: UUID
    staff_id: UUID
    gross_salary: Decimal
    components: list[SalaryComponent]
    effective_from: date
    updated_at: datetime


class PayrollRunCreate(BaseModel):
    period_month: int = Field(ge=1, le=12)
    period_year: int = Field(ge=2020, le=2100)


class PayrollRunResponse(BaseModel):
    id: UUID
    period_month: int
    period_year: int
    status: str
    payslip_count: int = 0
    total_net: Decimal = Decimal("0")
    created_at: datetime
    finalized_at: Optional[datetime] = None


class PayslipResponse(BaseModel):
    id: UUID
    run_id: UUID
    staff_id: UUID
    staff_name: str
    employee_no: str
    designation: Optional[str] = None
    gross_salary: Decimal
    allowances: list[PayslipLine]
    deductions: list[PayslipLine]
    net_salary: Decimal
    note: Optional[str] = None


class PayslipUpdate(BaseModel):
    allowances: list[PayslipLine]
    deductions: list[PayslipLine]
    note: Optional[str] = None

    @field_validator("allowances", "deductions")
    @classmethod
    def cap_lines(cls, v: list[PayslipLine]) -> list[PayslipLine]:
        if len(v) > 30:
            raise ValueError("Too many lines (max 30)")
        return v
