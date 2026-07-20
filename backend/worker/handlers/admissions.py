"""Admissions workflow handlers.

admission_stale (ADMISSION_STALE): a non-terminal admission has gone untouched for
too long → notify principal + VP so no lead is silently forgotten.
"""

from typing import TYPE_CHECKING

import asyncpg

if TYPE_CHECKING:
    from worker.registry import Event


async def admission_stale(conn: asyncpg.Connection, event: "Event") -> None:
    admission_id = event.payload["admission_id"]
    applicant_name = event.payload.get("applicant_name", "Applicant")
    status = event.payload.get("status", "enquiry")
    age_days = event.payload.get("age_days", 0)

    await conn.execute(
        """
        INSERT INTO notifications
            (tenant_id, recipient_type, recipient_id, type, title, body, ref)
        SELECT DISTINCT $1, 'user', u.id, 'ADMISSION_STALE',
               'Admission needs attention (' || $4 || ' days)',
               $5 || ' has been in "' || $3 || '" stage for ' || $4
                   || ' day(s) with no update. Please move it forward or mark it rejected.',
               $2
        FROM users u
        JOIN user_roles ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id
        WHERE u.tenant_id = $1
          AND ur.role IN ('principal', 'vice_principal')
        ON CONFLICT DO NOTHING
        """,
        event.tenant_id, admission_id, status, age_days, applicant_name,
    )
