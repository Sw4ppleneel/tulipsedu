import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class ActivityLogEntry(BaseModel):
    id: int
    event_type: str
    category: str
    created_at: datetime
    # Whoever/whatever the action was about — a student or a staff member,
    # whichever the event payload references. None for events with no single
    # subject (e.g. a bulk import).
    subject_name: Optional[str] = None
    actor_name: str
    summary: str
