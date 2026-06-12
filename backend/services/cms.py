import uuid
from datetime import datetime, timezone
from typing import Optional

import asyncpg

from models.cms import (
    AnnouncementCreate,
    AnnouncementResponse,
    AnnouncementUpdate,
    PageCreate,
    PageResponse,
    PageUpdate,
    SchoolInfo,
)


class CmsError(Exception):
    pass


# ── Pages ────────────────────────────────────────────────────────────────────

async def create_page(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, data: PageCreate
) -> PageResponse:
    try:
        row = await conn.fetchrow(
            """
            INSERT INTO cms_pages
                (tenant_id, slug, title, content_html, meta_description, is_published, sort_order)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
            """,
            tenant_id, data.slug.lower().strip(), data.title, data.content_html,
            data.meta_description, data.is_published, data.sort_order,
        )
    except asyncpg.UniqueViolationError:
        raise CmsError(f"A page with slug '{data.slug}' already exists")
    return PageResponse(**dict(row))


async def list_pages(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, published_only: bool = False
) -> list[PageResponse]:
    q = "SELECT * FROM cms_pages WHERE tenant_id = $1"
    if published_only:
        q += " AND is_published = TRUE"
    q += " ORDER BY sort_order, created_at"
    rows = await conn.fetch(q, tenant_id)
    return [PageResponse(**dict(r)) for r in rows]


async def get_page_by_slug(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, slug: str
) -> Optional[PageResponse]:
    row = await conn.fetchrow(
        "SELECT * FROM cms_pages WHERE tenant_id = $1 AND slug = $2 AND is_published = TRUE",
        tenant_id, slug.lower().strip(),
    )
    return PageResponse(**dict(row)) if row else None


async def update_page(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, page_id: uuid.UUID, data: PageUpdate
) -> Optional[PageResponse]:
    fields, vals = [], []
    if data.title is not None:
        fields.append(f"title = ${len(vals)+2}"); vals.append(data.title)
    if data.content_html is not None:
        fields.append(f"content_html = ${len(vals)+2}"); vals.append(data.content_html)
    if data.meta_description is not None:
        fields.append(f"meta_description = ${len(vals)+2}"); vals.append(data.meta_description)
    if data.is_published is not None:
        fields.append(f"is_published = ${len(vals)+2}"); vals.append(data.is_published)
    if data.sort_order is not None:
        fields.append(f"sort_order = ${len(vals)+2}"); vals.append(data.sort_order)
    if not fields:
        row = await conn.fetchrow(
            "SELECT * FROM cms_pages WHERE tenant_id = $1 AND id = $2", tenant_id, page_id
        )
        return PageResponse(**dict(row)) if row else None
    fields.append(f"updated_at = ${len(vals)+2}"); vals.append(datetime.now(timezone.utc))
    row = await conn.fetchrow(
        f"UPDATE cms_pages SET {', '.join(fields)} WHERE tenant_id = $1 AND id = ${len(vals)+2} RETURNING *",
        tenant_id, *vals, page_id,
    )
    return PageResponse(**dict(row)) if row else None


async def delete_page(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, page_id: uuid.UUID
) -> bool:
    result = await conn.execute(
        "DELETE FROM cms_pages WHERE tenant_id = $1 AND id = $2", tenant_id, page_id
    )
    return result != "DELETE 0"


# ── Announcements ─────────────────────────────────────────────────────────────

async def create_announcement(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, data: AnnouncementCreate
) -> AnnouncementResponse:
    row = await conn.fetchrow(
        """
        INSERT INTO cms_announcements
            (tenant_id, title, body, is_published, published_at, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
        """,
        tenant_id, data.title, data.body, data.is_published, data.published_at, data.expires_at,
    )
    return AnnouncementResponse(**dict(row))


async def list_announcements(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, active_only: bool = False
) -> list[AnnouncementResponse]:
    now = datetime.now(timezone.utc)
    if active_only:
        rows = await conn.fetch(
            """
            SELECT * FROM cms_announcements
            WHERE tenant_id = $1
              AND is_published = TRUE
              AND (expires_at IS NULL OR expires_at > $2)
            ORDER BY published_at DESC NULLS LAST, created_at DESC
            """,
            tenant_id, now,
        )
    else:
        rows = await conn.fetch(
            "SELECT * FROM cms_announcements WHERE tenant_id = $1 ORDER BY created_at DESC",
            tenant_id,
        )
    return [AnnouncementResponse(**dict(r)) for r in rows]


async def update_announcement(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    ann_id: uuid.UUID,
    data: AnnouncementUpdate,
) -> Optional[AnnouncementResponse]:
    fields, vals = [], []
    for attr, col in [
        ("title", "title"), ("body", "body"), ("is_published", "is_published"),
        ("published_at", "published_at"), ("expires_at", "expires_at"),
    ]:
        v = getattr(data, attr)
        if v is not None:
            fields.append(f"{col} = ${len(vals)+2}"); vals.append(v)
    if not fields:
        row = await conn.fetchrow(
            "SELECT * FROM cms_announcements WHERE tenant_id = $1 AND id = $2", tenant_id, ann_id
        )
        return AnnouncementResponse(**dict(row)) if row else None
    row = await conn.fetchrow(
        f"UPDATE cms_announcements SET {', '.join(fields)} WHERE tenant_id = $1 AND id = ${len(vals)+2} RETURNING *",
        tenant_id, *vals, ann_id,
    )
    return AnnouncementResponse(**dict(row)) if row else None


async def delete_announcement(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, ann_id: uuid.UUID
) -> bool:
    result = await conn.execute(
        "DELETE FROM cms_announcements WHERE tenant_id = $1 AND id = $2", tenant_id, ann_id
    )
    return result != "DELETE 0"


async def get_school_info(conn: asyncpg.Connection, tenant_id: uuid.UUID) -> SchoolInfo:
    row = await conn.fetchrow("SELECT name, slug FROM tenants WHERE id = $1", tenant_id)
    return SchoolInfo(name=row["name"], slug=row["slug"])
