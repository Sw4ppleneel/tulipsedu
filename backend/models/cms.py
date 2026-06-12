import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class PageCreate(BaseModel):
    slug: str
    title: str
    content_html: str = ""
    meta_description: Optional[str] = None
    is_published: bool = False
    sort_order: int = 0


class PageUpdate(BaseModel):
    title: Optional[str] = None
    content_html: Optional[str] = None
    meta_description: Optional[str] = None
    is_published: Optional[bool] = None
    sort_order: Optional[int] = None


class PageResponse(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    slug: str
    title: str
    content_html: str
    meta_description: Optional[str]
    is_published: bool
    sort_order: int
    updated_at: datetime
    created_at: datetime


class AnnouncementCreate(BaseModel):
    title: str
    body: str
    is_published: bool = False
    published_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None


class AnnouncementUpdate(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None
    is_published: Optional[bool] = None
    published_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None


class AnnouncementResponse(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    title: str
    body: str
    is_published: bool
    published_at: Optional[datetime]
    expires_at: Optional[datetime]
    created_at: datetime


class SchoolInfo(BaseModel):
    name: str
    slug: str
