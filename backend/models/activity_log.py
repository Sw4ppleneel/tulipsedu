import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class ActivityLogEntry(BaseModel):
    id: int
    event_type: str
    created_at: datetime
    student_name: Optional[str] = None
    actor_name: str
    summary: str
