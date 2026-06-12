"""Exam publish: parents of every student with marks in the published term get
a "results are out" notification. Dedup ref = term_id."""

import uuid
from typing import TYPE_CHECKING

import asyncpg

if TYPE_CHECKING:
    from worker.registry import Event


async def publish_notify(conn: asyncpg.Connection, event: "Event") -> None:
    term_id = uuid.UUID(event.payload["term_id"])

    await conn.execute(
        """
        INSERT INTO notifications
            (tenant_id, recipient_type, recipient_id, type, title, body, ref)
        SELECT DISTINCT me.tenant_id, 'parent_of_student', me.student_id,
               'EXAM_PUBLISHED',
               'Exam results published',
               'Results for ' || et.name || ' are now available in the parent portal.',
               $1::text
        FROM mark_entries me
        JOIN exam_terms et ON et.id = me.exam_term_id AND et.tenant_id = me.tenant_id
        WHERE me.exam_term_id = $2 AND me.tenant_id = $3
        ON CONFLICT DO NOTHING
        """,
        str(term_id), term_id, event.tenant_id,
    )
