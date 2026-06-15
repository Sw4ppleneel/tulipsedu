"""Workflow worker: consumes audit_events (immutable outbox) and dispatches
to handlers; runs time-based scans (fee overdue).

Run: python -m worker.main   (same image/env as the API; DATABASE_URL required)

Semantics: at-least-once. The cursor advances after an event's handlers run,
so a crash in between re-runs them — every handler is idempotent via
notifications_dedup_idx. Failed handlers go to worker_dlq and are retried
with exponential backoff (capped attempts); the stream never blocks on a
poison event. Single instance by design (no row locking needed).
"""

import asyncio
import json
import logging
import signal
import time
from contextlib import suppress

import asyncpg

from config import settings
from worker.registry import HANDLERS, Event
from worker.scheduler import (
    admissions_aging,
    fee_overdue_scan,
    gateway_payment_sweep,
    money_reconciliation,
    payment_claim_escalation,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("worker")

CONSUMER = "main"
MAX_ATTEMPTS = 5
RETRY_BATCH = 20
SCAN_INTERVAL_SECONDS = 3600
RECONCILE_INTERVAL_SECONDS = 86400  # daily money-integrity tripwire


async def wait_for_migrations(pool: asyncpg.Pool, version: str) -> None:
    """The backend's entrypoint owns migrations; block until ours is applied."""
    while True:
        with suppress(asyncpg.PostgresError):
            applied = await pool.fetchval(
                "SELECT 1 FROM schema_migrations WHERE version = $1", version
            )
            if applied:
                return
        logger.info("waiting for migration %s ...", version)
        await asyncio.sleep(2)


async def _dlq_insert(conn: asyncpg.Connection, event: Event, handler_name: str, error: str) -> None:
    await conn.execute(
        """
        INSERT INTO worker_dlq
            (event_id, tenant_id, handler, event_type, payload, error, attempts, next_retry_at)
        VALUES ($1, $2, $3, $4, $5, $6, 1, NOW() + interval '30 seconds')
        """,
        event.id, event.tenant_id, handler_name, event.event_type,
        json.dumps(event.payload), error[:2000],
    )


async def _retry_dlq(conn: asyncpg.Connection) -> None:
    rows = await conn.fetch(
        """
        SELECT id, event_id, tenant_id, event_type, payload, handler, attempts
        FROM worker_dlq
        WHERE resolved_at IS NULL AND attempts < $1 AND next_retry_at <= NOW()
        ORDER BY next_retry_at
        LIMIT $2
        """,
        MAX_ATTEMPTS, RETRY_BATCH,
    )
    if not rows:
        return

    by_name = {
        h.__name__: h for handlers in HANDLERS.values() for h in handlers
    }
    for row in rows:
        handler = by_name.get(row["handler"])
        if handler is None:  # handler removed from registry — park it
            await conn.execute(
                "UPDATE worker_dlq SET resolved_at = NOW(), error = error || ' [handler gone]' WHERE id = $1",
                row["id"],
            )
            continue
        payload = row["payload"]
        if isinstance(payload, str):
            payload = json.loads(payload)
        event = Event(
            id=row["event_id"], tenant_id=row["tenant_id"],
            event_type=row["event_type"], payload=payload or {},
            created_at=None,  # type: ignore[arg-type] — retries don't need it
        )
        try:
            await handler(conn, event)
            await conn.execute(
                "UPDATE worker_dlq SET resolved_at = NOW() WHERE id = $1", row["id"]
            )
            logger.info("dlq retry ok: event=%d handler=%s", event.id, row["handler"])
        except Exception as exc:  # noqa: BLE001 — DLQ must never crash the loop
            backoff = min(30 * (2 ** row["attempts"]), 3600)
            await conn.execute(
                """
                UPDATE worker_dlq
                SET attempts = attempts + 1, error = $2,
                    next_retry_at = NOW() + ($3 || ' seconds')::interval
                WHERE id = $1
                """,
                row["id"], repr(exc)[:2000], str(backoff),
            )
            logger.warning(
                "dlq retry failed: event=%d handler=%s attempts=%d",
                event.id, row["handler"], row["attempts"] + 1,
            )


async def _process_batch(conn: asyncpg.Connection) -> int:
    cursor = await conn.fetchval(
        "SELECT last_event_id FROM worker_cursors WHERE consumer = $1", CONSUMER
    )
    rows = await conn.fetch(
        """
        SELECT id, tenant_id, event_type, payload, created_at
        FROM audit_events
        WHERE id > $1
        ORDER BY id
        LIMIT $2
        """,
        cursor, settings.worker_batch_size,
    )
    for row in rows:
        event = Event.from_row(row)
        for handler in HANDLERS.get(event.event_type, []):
            try:
                await handler(conn, event)
            except Exception as exc:  # noqa: BLE001 — park it, keep the stream moving
                logger.warning(
                    "handler failed → dlq: event=%d type=%s handler=%s",
                    event.id, event.event_type, handler.__name__,
                )
                await _dlq_insert(conn, event, handler.__name__, repr(exc))
        await conn.execute(
            "UPDATE worker_cursors SET last_event_id = $1, updated_at = NOW() WHERE consumer = $2",
            event.id, CONSUMER,
        )
    return len(rows)


async def run() -> None:
    pool = await asyncpg.create_pool(settings.database_url, min_size=1, max_size=3)
    await wait_for_migrations(pool, "024_worker_spine.sql")
    logger.info("worker started (poll=%ss batch=%s)", settings.worker_poll_seconds, settings.worker_batch_size)

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)

    # Run the money-integrity tripwire once at startup (validates every deploy),
    # then on the daily cadence below.
    with suppress(Exception):
        async with pool.acquire() as conn:
            await money_reconciliation(conn)
    last_scan = 0.0
    last_reconcile = time.monotonic()
    last_escalation = 0.0
    while not stop.is_set():
        try:
            async with pool.acquire() as conn:
                processed = await _process_batch(conn)
                await _retry_dlq(conn)
                if time.monotonic() - last_scan > SCAN_INTERVAL_SECONDS:
                    await fee_overdue_scan(conn)
                    await payment_claim_escalation(conn)
                    await gateway_payment_sweep(conn)
                    await admissions_aging(conn)
                    last_scan = time.monotonic()
                if time.monotonic() - last_reconcile > RECONCILE_INTERVAL_SECONDS:
                    await money_reconciliation(conn)
                    last_reconcile = time.monotonic()
        except Exception:  # noqa: BLE001 — e.g. DB restart; back off and retry
            logger.exception("worker tick failed; backing off")
            processed = 0
            with suppress(asyncio.TimeoutError):
                await asyncio.wait_for(stop.wait(), timeout=10)
        if not processed:
            with suppress(asyncio.TimeoutError):
                await asyncio.wait_for(stop.wait(), timeout=settings.worker_poll_seconds)

    logger.info("worker stopping (signal received)")
    await pool.close()


if __name__ == "__main__":
    asyncio.run(run())
