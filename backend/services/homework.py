import json
import uuid
from typing import Optional

import asyncpg

from core.events import emit
from models.homework import HomeworkCreate, HomeworkResponse, HomeworkUpdate


class HomeworkError(Exception):
    pass


_JOIN = """
    SELECT
        hp.*,
        c.name   AS class_name,
        sec.name AS section_name,
        s.first_name || ' ' || s.last_name AS staff_name
    FROM homework_posts hp
    JOIN classes   c   ON c.id   = hp.class_id
    JOIN sections  sec ON sec.id = hp.section_id
    LEFT JOIN staff s  ON s.id   = hp.staff_id
"""


def _to_response(r: asyncpg.Record) -> HomeworkResponse:
    d = dict(r)
    d["attachment_urls"] = json.loads(d["attachment_urls"]) if isinstance(d["attachment_urls"], str) else (d["attachment_urls"] or [])
    return HomeworkResponse(**d)


async def create_post(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, data: HomeworkCreate,
    posted_by: Optional[uuid.UUID] = None,
) -> HomeworkResponse:
    row = await conn.fetchrow(
        """
        INSERT INTO homework_posts
            (tenant_id, academic_year_id, class_id, section_id, staff_id,
             subject, post_type, title, description, due_date, attachment_urls)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        RETURNING *
        """,
        tenant_id, data.academic_year_id, data.class_id, data.section_id,
        data.staff_id, data.subject, data.post_type, data.title,
        data.description, data.due_date,
        json.dumps(data.attachment_urls),
    )
    full = await conn.fetchrow(f"{_JOIN} WHERE hp.id = $1", row["id"])
    await emit(conn, "HOMEWORK_ASSIGNED", tenant_id, {
        "post_id": str(row["id"]),
        "class_id": str(data.class_id),
        "section_id": str(data.section_id),
        "post_type": data.post_type,
        "posted_by": str(posted_by) if posted_by else None,
    })
    return _to_response(full)


async def list_posts(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    class_id: Optional[uuid.UUID] = None,
    section_id: Optional[uuid.UUID] = None,
    post_type: Optional[str] = None,
    academic_year_id: Optional[uuid.UUID] = None,
    limit: int = 50,
    offset: int = 0,
) -> list[HomeworkResponse]:
    rows = await conn.fetch(
        f"""
        {_JOIN}
        WHERE hp.tenant_id = $1 AND hp.is_active = TRUE
          AND ($2::uuid IS NULL OR hp.class_id         = $2::uuid)
          AND ($3::uuid IS NULL OR hp.section_id       = $3::uuid)
          AND ($4::text IS NULL OR hp.post_type        = $4)
          AND ($5::uuid IS NULL OR hp.academic_year_id = $5::uuid)
        ORDER BY hp.created_at DESC
        LIMIT $6 OFFSET $7
        """,
        tenant_id, class_id, section_id, post_type, academic_year_id, limit, offset,
    )
    return [_to_response(r) for r in rows]


async def update_post(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    post_id: uuid.UUID,
    data: HomeworkUpdate,
    updated_by: Optional[uuid.UUID] = None,
) -> Optional[HomeworkResponse]:
    fields = data.model_dump(exclude_none=True)
    if "attachment_urls" in fields:
        fields["attachment_urls"] = json.dumps(fields["attachment_urls"])
    if not fields:
        row = await conn.fetchrow(f"{_JOIN} WHERE hp.id = $1 AND hp.tenant_id = $2", post_id, tenant_id)
        return _to_response(row) if row else None

    set_clause = ", ".join(f"{k} = ${i + 3}" for i, k in enumerate(fields))
    row = await conn.fetchrow(
        f"UPDATE homework_posts SET {set_clause} WHERE id = $1 AND tenant_id = $2 RETURNING id",
        post_id, tenant_id, *fields.values(),
    )
    if not row:
        return None
    await emit(conn, "HOMEWORK_UPDATED", tenant_id, {
        "post_id": str(post_id),
        "fields": list(fields.keys()),
        "updated_by": str(updated_by) if updated_by else None,
    })
    full = await conn.fetchrow(f"{_JOIN} WHERE hp.id = $1", post_id)
    return _to_response(full)


async def delete_post(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, post_id: uuid.UUID,
    deleted_by: Optional[uuid.UUID] = None,
) -> bool:
    result = await conn.execute(
        "UPDATE homework_posts SET is_active = FALSE WHERE id = $1 AND tenant_id = $2 AND is_active = TRUE",
        post_id, tenant_id,
    )
    if result != "UPDATE 1":
        return False
    await emit(conn, "HOMEWORK_DELETED", tenant_id, {
        "post_id": str(post_id),
        "deleted_by": str(deleted_by) if deleted_by else None,
    })
    return True
