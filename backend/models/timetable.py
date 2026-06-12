from datetime import datetime, time
from typing import Optional
from uuid import UUID

from pydantic import BaseModel

DAY_NAMES = {1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday"}


class SlotUpsert(BaseModel):
    academic_year_id: UUID
    class_id: UUID
    section_id: UUID
    day_of_week: int
    period_number: int
    start_time: str   # "08:00"
    end_time: str     # "08:45"
    subject: str
    staff_id: Optional[UUID] = None
    room: Optional[str] = None


class SlotResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    academic_year_id: UUID
    class_id: UUID
    section_id: UUID
    day_of_week: int
    day_name: Optional[str] = None
    period_number: int
    start_time: str
    end_time: str
    subject: str
    staff_id: Optional[UUID]
    staff_name: Optional[str] = None
    room: Optional[str]
    created_at: datetime


class WeeklyTimetable(BaseModel):
    class_id: UUID
    section_id: UUID
    academic_year_id: UUID
    class_name: str
    section_name: str
    slots: list[SlotResponse]
