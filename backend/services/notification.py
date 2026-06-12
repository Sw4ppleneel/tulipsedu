"""In-app notifications: read paths for staff (user) and parent (student-scoped)
recipients. Writes are done by the worker handlers (set-based INSERTs with
ON CONFLICT DO NOTHING against notifications_dedup_idx)."""

import uuid

import asyncpg

from models.notification import NotificationResponse

_COLS = "id, type, title, body, ref, read_at, created_at"


async def list_for_recipient(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    recipient_type: str,
    recipient_id: uuid.UUID,
    limit: int = 20,
    offset: int = 0,
) -> list[NotificationResponse]:
    rows = await conn.fetch(
        f"""
        SELECT {_COLS} FROM notifications
        WHERE tenant_id = $1 AND recipient_type = $2 AND recipient_id = $3
        ORDER BY created_at DESC
        LIMIT $4 OFFSET $5
        """,
        tenant_id, recipient_type, recipient_id, limit, offset,
    )
    return [NotificationResponse(**dict(r)) for r in rows]


async def unread_count(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    recipient_type: str,
    recipient_id: uuid.UUID,
) -> int:
    return await conn.fetchval(
        """
        SELECT COUNT(*) FROM notifications
        WHERE tenant_id = $1 AND recipient_type = $2 AND recipient_id = $3
          AND read_at IS NULL
        """,
        tenant_id, recipient_type, recipient_id,
    )


async def mark_read(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    recipient_type: str,
    recipient_id: uuid.UUID,
    notification_id: uuid.UUID,
) -> bool:
    """Scoped by tenant AND recipient — a caller can only read their own."""
    result = await conn.execute(
        """
        UPDATE notifications SET read_at = NOW()
        WHERE id = $1 AND tenant_id = $2 AND recipient_type = $3 AND recipient_id = $4
          AND read_at IS NULL
        """,
        notification_id, tenant_id, recipient_type, recipient_id,
    )
    return result.endswith("1")


async def mark_all_read(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    recipient_type: str,
    recipient_id: uuid.UUID,
) -> int:
    result = await conn.execute(
        """
        UPDATE notifications SET read_at = NOW()
        WHERE tenant_id = $1 AND recipient_type = $2 AND recipient_id = $3
          AND read_at IS NULL
        """,
        tenant_id, recipient_type, recipient_id,
    )
    return int(result.split()[-1])
