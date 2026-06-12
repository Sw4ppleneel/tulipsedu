"""Homework ping: parents of all active students in the post's class-section
get a notification when homework/announcements/resources are posted.
Dedup ref = post_id (one ping per student per post)."""

import uuid
from typing import TYPE_CHECKING

import asyncpg

if TYPE_CHECKING:
    from worker.registry import Event

_TITLES = {
    "homework": "New homework",
    "announcement": "New announcement",
    "resource": "New study material",
}


async def parent_ping(conn: asyncpg.Connection, event: "Event") -> None:
    post_id = event.payload["post_id"]
    class_id = uuid.UUID(event.payload["class_id"])
    section_id = uuid.UUID(event.payload["section_id"])
    title = _TITLES.get(event.payload.get("post_type", ""), "New classroom post")

    await conn.execute(
        """
        INSERT INTO notifications
            (tenant_id, recipient_type, recipient_id, type, title, body, ref)
        SELECT st.tenant_id, 'parent_of_student', st.id, 'HOMEWORK',
               $1,
               COALESCE(hp.subject || ': ', '') || hp.title
                   || COALESCE(' — due ' || to_char(hp.due_date, 'DD Mon'), ''),
               $2::text
        FROM students st
        JOIN homework_posts hp ON hp.id = $3::uuid AND hp.tenant_id = st.tenant_id
        WHERE st.tenant_id = $4 AND st.class_id = $5 AND st.section_id = $6
          AND st.is_active = TRUE
        ON CONFLICT DO NOTHING
        """,
        title, post_id, post_id, event.tenant_id, class_id, section_id,
    )
