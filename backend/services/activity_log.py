"""Principal-facing view over audit_events for the specific things owners
asked to be able to review: who edited a student record, who waived a fee,
and who set/cleared a sibling discount. audit_events itself stays the
immutable, generic append-only log (Security Rules); this is a read-only,
human-readable projection over three event types, resolving the actor and
student UUIDs embedded in each payload into names.
"""
import json
import uuid

import asyncpg

from models.activity_log import ActivityLogEntry

_EVENT_TYPES = ("STUDENT_UPDATED", "FEE_WAIVED", "STUDENT_DISCOUNT_SET")

# Which payload key holds the acting user's id, per event type.
_ACTOR_KEY = {
    "STUDENT_UPDATED": "updated_by",
    "FEE_WAIVED": "waived_by",
    "STUDENT_DISCOUNT_SET": "set_by",
}

_SUMMARY = {
    "STUDENT_UPDATED": lambda p: f"Edited: {', '.join(p.get('fields', []))}",
    "FEE_WAIVED": lambda p: f"Waived ₹{p.get('total', '?')} — {p.get('reason', '')}",
    "STUDENT_DISCOUNT_SET": lambda p: (
        f"Cleared discounts ({p.get('rows_updated', 0)} rows restored)"
        if not p.get("discounts")
        else f"Set discount ({len(p.get('discounts', []))} fee head(s), {p.get('rows_updated', 0)} rows updated)"
    ),
}


async def list_activity(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, limit: int = 100, offset: int = 0
) -> list[ActivityLogEntry]:
    rows = await conn.fetch(
        """
        SELECT id, event_type, payload, created_at
        FROM audit_events
        WHERE tenant_id = $1 AND event_type = ANY($2::text[])
        ORDER BY created_at DESC
        LIMIT $3 OFFSET $4
        """,
        tenant_id, list(_EVENT_TYPES), limit, offset,
    )
    if not rows:
        return []

    parsed = []
    student_ids: set[uuid.UUID] = set()
    actor_ids: set[uuid.UUID] = set()
    for r in rows:
        payload = json.loads(r["payload"]) if isinstance(r["payload"], str) else r["payload"]
        parsed.append((r["id"], r["event_type"], payload, r["created_at"]))
        sid = payload.get("student_id")
        if sid:
            student_ids.add(uuid.UUID(sid))
        actor_key = _ACTOR_KEY.get(r["event_type"])
        actor_raw = payload.get(actor_key) if actor_key else None
        if actor_raw:
            try:
                actor_ids.add(uuid.UUID(actor_raw))
            except ValueError:
                pass  # non-UUID actor value (e.g. "system") — skip resolution

    student_names: dict[str, str] = {}
    if student_ids:
        srows = await conn.fetch(
            "SELECT id, first_name, last_name, admission_no FROM students WHERE tenant_id = $1 AND id = ANY($2::uuid[])",
            tenant_id, list(student_ids),
        )
        student_names = {
            str(s["id"]): f"{s['first_name']} {s['last_name']} ({s['admission_no']})" for s in srows
        }

    actor_names: dict[str, str] = {}
    if actor_ids:
        arows = await conn.fetch(
            """
            SELECT u.id, s.first_name, s.last_name, u.role
            FROM users u LEFT JOIN staff s ON s.user_id = u.id AND s.tenant_id = u.tenant_id
            WHERE u.tenant_id = $1 AND u.id = ANY($2::uuid[])
            """,
            tenant_id, list(actor_ids),
        )
        actor_names = {
            str(a["id"]): (f"{a['first_name']} {a['last_name']}" if a["first_name"] else a["role"])
            for a in arows
        }

    entries = []
    for eid, event_type, payload, created_at in parsed:
        actor_key = _ACTOR_KEY.get(event_type)
        actor_raw = payload.get(actor_key) if actor_key else None
        entries.append(ActivityLogEntry(
            id=eid,
            event_type=event_type,
            created_at=created_at,
            student_name=student_names.get(payload.get("student_id"), None),
            actor_name=actor_names.get(actor_raw, actor_raw or "unknown"),
            summary=_SUMMARY.get(event_type, lambda p: event_type)(payload),
        ))
    return entries
