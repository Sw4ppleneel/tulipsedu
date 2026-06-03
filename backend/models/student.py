from datetime import date, datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, field_validator


class AcademicYearCreate(BaseModel):
    name: str
    start_date: date
    end_date: date


class AcademicYearResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    name: str
    start_date: date
    end_date: date
    is_current: bool
    created_at: datetime


class ClassCreate(BaseModel):
    name: str
    numeric_order: Optional[int] = None


class SectionCreate(BaseModel):
    name: str


class SectionResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    class_id: UUID
    name: str


class ClassResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    name: str
    numeric_order: Optional[int] = None
    sections: list[SectionResponse] = []


class StudentCreate(BaseModel):
    academic_year_id: UUID
    class_id: UUID
    section_id: UUID
    admission_no: str
    roll_number: str
    first_name: str
    last_name: str
    date_of_birth: date
    gender: str
    parent_phone: str
    is_hosteler: bool = False

    @field_validator("parent_phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        digits = "".join(c for c in v if c.isdigit())
        if len(digits) != 10:
            raise ValueError("Parent phone must be exactly 10 digits")
        return digits

    @field_validator("gender")
    @classmethod
    def validate_gender(cls, v: str) -> str:
        allowed = {"Male", "Female", "Other"}
        if v not in allowed:
            raise ValueError(f"Gender must be one of: {', '.join(sorted(allowed))}")
        return v


class StudentUpdate(BaseModel):
    class_id: Optional[UUID] = None
    section_id: Optional[UUID] = None
    roll_number: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    date_of_birth: Optional[date] = None
    gender: Optional[str] = None
    parent_phone: Optional[str] = None
    is_hosteler: Optional[bool] = None
    is_active: Optional[bool] = None


class StudentResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    academic_year_id: UUID
    class_id: UUID
    section_id: UUID
    admission_no: str
    roll_number: str
    first_name: str
    last_name: str
    date_of_birth: date
    gender: str
    parent_phone: str
    is_hosteler: bool
    is_active: bool
    created_at: datetime
    class_name: Optional[str] = None
    section_name: Optional[str] = None
    academic_year_name: Optional[str] = None


class StudentListResponse(BaseModel):
    items: list[StudentResponse]
    total: int
