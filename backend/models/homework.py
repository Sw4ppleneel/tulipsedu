from datetime import date, datetime
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel


class HomeworkCreate(BaseModel):
    academic_year_id: UUID
    class_id: UUID
    section_id: UUID
    staff_id: Optional[UUID] = None
    subject: str
    post_type: Literal["homework", "announcement", "resource"] = "homework"
    title: str
    description: Optional[str] = None
    due_date: Optional[date] = None
    attachment_urls: list[dict] = []


class HomeworkUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    due_date: Optional[date] = None
    attachment_urls: Optional[list[dict]] = None
    is_active: Optional[bool] = None


class HomeworkResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    academic_year_id: UUID
    class_id: UUID
    section_id: UUID
    staff_id: Optional[UUID]
    subject: str
    post_type: str
    title: str
    description: Optional[str]
    due_date: Optional[date]
    attachment_urls: list[dict]
    is_active: bool
    created_at: datetime
    class_name: Optional[str] = None
    section_name: Optional[str] = None
    staff_name: Optional[str] = None
