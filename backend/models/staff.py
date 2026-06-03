from datetime import date, datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, field_validator


class StaffCreate(BaseModel):
    employee_no: str
    first_name: str
    last_name: str
    phone_number: str
    designation: str
    department: Optional[str] = None
    date_of_joining: date
    date_of_birth: Optional[date] = None
    user_id: Optional[UUID] = None

    @field_validator("phone_number")
    @classmethod
    def normalize_phone(cls, v: str) -> str:
        digits = "".join(c for c in v if c.isdigit() or c == "+")
        if not digits:
            raise ValueError("Invalid phone number")
        return digits


class StaffUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone_number: Optional[str] = None
    designation: Optional[str] = None
    department: Optional[str] = None
    date_of_joining: Optional[date] = None
    date_of_birth: Optional[date] = None
    user_id: Optional[UUID] = None
    is_active: Optional[bool] = None


class StaffResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    user_id: Optional[UUID]
    employee_no: str
    first_name: str
    last_name: str
    phone_number: str
    designation: str
    department: Optional[str]
    date_of_joining: date
    date_of_birth: Optional[date]
    is_active: bool
    created_at: datetime


class AssignmentCreate(BaseModel):
    academic_year_id: UUID
    class_id: UUID
    section_id: UUID
    subject: Optional[str] = None
    is_class_teacher: bool = False


class AssignmentResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    staff_id: UUID
    academic_year_id: UUID
    class_id: UUID
    section_id: UUID
    subject: Optional[str]
    is_class_teacher: bool
    created_at: datetime
    # Joined display fields
    class_name: Optional[str] = None
    section_name: Optional[str] = None
    academic_year_name: Optional[str] = None
