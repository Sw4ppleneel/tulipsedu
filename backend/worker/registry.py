"""Event → handler registry for the workflow worker.

Contract for every handler:
- signature: async def handler(conn, event) -> None
- idempotent: notification inserts use ON CONFLICT DO NOTHING against
  notifications_dedup_idx, so at-least-once delivery is safe
- tenant-scoped: every query filters by event.tenant_id
- no PII in logs or raised errors (event ids only)
"""

import json
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Awaitable, Callable

import asyncpg

from worker.handlers import attendance, exams, fees, homework


@dataclass(frozen=True)
class Event:
    id: int
    tenant_id: uuid.UUID
    event_type: str
    payload: dict
    created_at: datetime

    @classmethod
    def from_row(cls, row: asyncpg.Record) -> "Event":
        payload = row["payload"]
        if isinstance(payload, str):  # asyncpg returns JSONB as str without a codec
            payload = json.loads(payload)
        return cls(
            id=row["id"],
            tenant_id=row["tenant_id"],
            event_type=row["event_type"],
            payload=payload or {},
            created_at=row["created_at"],
        )


Handler = Callable[[asyncpg.Connection, Event], Awaitable[None]]

HANDLERS: dict[str, list[Handler]] = {
    # Finality signal for a session's marks → alert parents of absentees.
    "ATTENDANCE_SESSION_SUBMITTED": [attendance.absent_alert],
    # Post-submit corrections may flip P→A → re-run (dedup makes it safe).
    "ATTENDANCE_CORRECTED": [attendance.absent_alert],
    # Principal edit to a day-locked session — same alert path, dedup-safe.
    "ATTENDANCE_OVERRIDE": [attendance.absent_alert],
    # Any successful payment (gateway webhook or mock/cash flow).
    "FEE_PAID": [fees.receipt_push],
    # Accountant's manual "send reminder" button (was a dead log before).
    "REMINDER_SENT": [fees.manual_reminder],
    # Parent self-reported a UPI payment → accountants get a verify notice.
    "FEE_PAYMENT_CLAIMED": [fees.payment_claimed],
    # Accountant rejected a claimed payment → parent is told.
    "FEE_PAYMENT_REJECTED": [fees.payment_rejected],
    "HOMEWORK_ASSIGNED": [homework.parent_ping],
    "EXAM_PUBLISHED": [exams.publish_notify],
    # Lifecycle transitions — no push needed for these; they're internal signals.
    "EXAM_MARKS_OPENED": [],
    "EXAM_MARKS_LOCKED": [],
    "EXAM_REOPENED":     [],
}
