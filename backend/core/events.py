import json
import uuid

import asyncpg


async def emit(conn: asyncpg.Connection, event_type: str, tenant_id: uuid.UUID, payload: dict) -> None:
    await conn.execute(
        "INSERT INTO audit_events (tenant_id, event_type, payload) VALUES ($1, $2, $3)",
        tenant_id,
        event_type,
        json.dumps(payload),
    )
