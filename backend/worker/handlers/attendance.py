"""Absent alerts: parents of students marked 'A' in a session get a notification.

Triggered by ATTENDANCE_SESSION_SUBMITTED (finality) and ATTENDANCE_CORRECTED
(post-submit P→A edits). Dedup: one ABSENT notification per (student, session)
via notifications_dedup_idx — re-processing or re-submitting is a no-op.
Accepted limitation: an A→P correction does not retract an already-sent alert.
"""

import uuid
from typing import TYPE_CHECKING

import asyncpg

if TYPE_CHECKING:
    from worker.registry import Event


async def absent_alert(conn: asyncpg.Connection, event: "Event") -> None:
    session_id = uuid.UUID(event.payload["session_id"])

    # Only alert once the session has been submitted (a CORRECTED event can
    # only occur on submitted sessions; this guards the SUBMITTED path too).
    await conn.execute(
        """
        INSERT INTO notifications
            (tenant_id, recipient_type, recipient_id, type, title, body, ref)
        SELECT
            ar.tenant_id,
            'parent_of_student',
            ar.student_id,
            'ABSENT',
            'Absent today',
            st.first_name || ' ' || st.last_name
                || ' was marked absent on ' || to_char(s.date, 'DD Mon YYYY')
                || ' (' || c.name || ' ' || sec.name || ')',
            $1::text
        FROM attendance_records ar
        JOIN attendance_sessions s ON s.id = ar.session_id AND s.tenant_id = ar.tenant_id
        JOIN students st           ON st.id = ar.student_id AND st.tenant_id = ar.tenant_id
        JOIN classes c             ON c.id = s.class_id
        JOIN sections sec          ON sec.id = s.section_id
        WHERE ar.session_id = $2
          AND ar.tenant_id = $3
          AND ar.status = 'A'
          AND s.submitted = TRUE
        ON CONFLICT DO NOTHING
        """,
        str(session_id), session_id, event.tenant_id,
    )
