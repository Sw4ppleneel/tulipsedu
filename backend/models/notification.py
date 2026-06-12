import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class NotificationResponse(BaseModel):
    id: uuid.UUID
    type: str
    title: str
    body: str
    ref: Optional[str] = None
    read_at: Optional[datetime] = None
    created_at: datetime


class UnreadCount(BaseModel):
    unread: int
