"""Local verification for the workflow spine (migration 024 + worker).

Drives the REAL worker code paths against the dev DB:
  registry → handler SQL → notifications_dedup_idx → cursor advance → scheduler.

Idempotent and self-cleaning: every row it creates is removed at the end and the
cursor is restored to its starting value. Run with the backend venv active:

    DATABASE_URL=postgresql://tulips:tulips@localhost:5432/tulipsedu \
        python scripts/verify_worker_spine.py
"""

import asyncio
import json
import sys

import asyncpg

from config import settings
from worker import main as worker_main
from worker.handlers import attendance as h_attendance, fees as h_fees
from worker.registry import Event
from worker.scheduler import fee_overdue_scan


class _Rollback(Exception):
    """Sentinel to unwind a verification transaction, leaving no trace."""

PASS, FAIL = "✓ PASS", "✗ FAIL"
results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    print(f"  {PASS if ok else FAIL}  {name}{(' — ' + detail) if detail else ''}")


async def emit(conn, tenant_id, event_type, payload) -> int:
    return await conn.fetchval(
        "INSERT INTO audit_events (tenant_id, event_type, payload) VALUES ($1,$2,$3) RETURNING id",
        tenant_id, event_type, json.dumps(payload),
    )


async def notif_count(conn, tenant_id, typ, ref) -> int:
    return await conn.fetchval(
        "SELECT count(*) FROM notifications WHERE tenant_id=$1 AND type=$2 AND ref=$3",
        tenant_id, typ, str(ref),
    )


async def run() -> None:
    pool = await asyncpg.create_pool(settings.database_url, min_size=1, max_size=2)
    start_cursor = await pool.fetchval("SELECT last_event_id FROM worker_cursors WHERE consumer='main'")
    created_event_ids: list[int] = []
    ledger_restore: dict = {}      # id -> (period_year, period_month, reminded_at)
    pre_stamped: set = set()       # ledger ids already reminded before this run

    try:
        async with pool.acquire() as conn:
            # ── Flow 1: cursor bootstrapped at head ──────────────────────────
            head = await conn.fetchval("SELECT COALESCE(MAX(id),0) FROM audit_events")
            check("flow1 cursor at head (no replay)", start_cursor == head,
                  f"cursor={start_cursor} head={head}")

            # ── Flow 2: absent alert fan-out (rolled back — no seed mutation) ─
            sess = await conn.fetchrow(
                "SELECT id, tenant_id, class_id, section_id FROM attendance_sessions "
                "WHERE class_id IS NOT NULL AND section_id IS NOT NULL LIMIT 1")
            if sess:
                stu = await conn.fetchrow(
                    "SELECT id FROM students WHERE tenant_id=$1 AND class_id=$2 AND section_id=$3 AND is_active LIMIT 1",
                    sess["tenant_id"], sess["class_id"], sess["section_id"])
            if sess and stu:
                try:
                    async with conn.transaction():
                        await conn.execute("UPDATE attendance_sessions SET submitted=TRUE WHERE id=$1", sess["id"])
                        await conn.execute(
                            "INSERT INTO attendance_records (tenant_id, session_id, student_id, status) "
                            "VALUES ($1,$2,$3,'A') "
                            "ON CONFLICT (tenant_id, session_id, student_id) DO UPDATE SET status='A'",
                            sess["tenant_id"], sess["id"], stu["id"])
                        ev = Event(id=0, tenant_id=sess["tenant_id"],
                                   event_type="ATTENDANCE_SESSION_SUBMITTED",
                                   payload={"session_id": str(sess["id"])}, created_at=None)
                        await h_attendance.absent_alert(conn, ev)
                        # dedup proof: second run must not add a row
                        await h_attendance.absent_alert(conn, ev)
                        c = await notif_count(conn, sess["tenant_id"], "ABSENT", sess["id"])
                        check("flow2 absent alert → one notif per absentee (dedup holds)",
                              c == 1, f"notifs={c}")
                        raise _Rollback
                except _Rollback:
                    pass
            else:
                check("flow2 absent alert", False, "no session+active student to exercise")

            # ── Flow 3: receipt push (real parent notif, cleaned up after) ───
            rstu = await conn.fetchrow(
                "SELECT id, tenant_id FROM students WHERE is_active LIMIT 1")
            if rstu:
                pay_id = "verify-pay-0001"
                ev = Event(id=0, tenant_id=rstu["tenant_id"], event_type="FEE_PAID",
                           payload={"payment_id": pay_id, "student_id": str(rstu["id"]),
                                    "amount": "1200", "receipt_number": "VERIFY-R1"},
                           created_at=None)
                await h_fees.receipt_push(conn, ev)
                await h_fees.receipt_push(conn, ev)  # dedup
                rc = await conn.fetchval(
                    "SELECT count(*) FROM notifications WHERE tenant_id=$1 AND type='FEE_RECEIPT' AND ref=$2",
                    rstu["tenant_id"], pay_id)
                check("flow3 receipt push → parent FEE_RECEIPT (dedup by payment_id)",
                      rc == 1, f"receipts={rc}")
            else:
                check("flow3 receipt push", False, "no active student")

            # ── Flow 4: homework ping + idempotency ──────────────────────────
            hp = await conn.fetchrow(
                """
                SELECT hp.id, hp.tenant_id, hp.class_id, hp.section_id, hp.post_type,
                       (SELECT count(*) FROM students st
                          WHERE st.tenant_id=hp.tenant_id AND st.class_id=hp.class_id
                            AND st.section_id=hp.section_id AND st.is_active) AS n_students
                FROM homework_posts hp
                WHERE hp.class_id IS NOT NULL AND hp.section_id IS NOT NULL
                ORDER BY n_students DESC LIMIT 1
                """
            )
            if hp and hp["n_students"] > 0:
                payload = {
                    "post_id": str(hp["id"]), "class_id": str(hp["class_id"]),
                    "section_id": str(hp["section_id"]), "post_type": hp["post_type"],
                }
                eid = await emit(conn, hp["tenant_id"], "HOMEWORK_ASSIGNED", payload)
                created_event_ids.append(eid)
                await worker_main._process_batch(conn)
                c1 = await notif_count(conn, hp["tenant_id"], "HOMEWORK", hp["id"])
                check("flow4 homework ping fans out to section parents",
                      c1 == hp["n_students"], f"notifs={c1} students={hp['n_students']}")

                # Re-emit same post (new event id) + rewind cursor → must NOT duplicate.
                eid2 = await emit(conn, hp["tenant_id"], "HOMEWORK_ASSIGNED", payload)
                created_event_ids.append(eid2)
                await conn.execute("UPDATE worker_cursors SET last_event_id=$1 WHERE consumer='main'", eid - 1)
                await worker_main._process_batch(conn)
                c2 = await notif_count(conn, hp["tenant_id"], "HOMEWORK", hp["id"])
                check("flow4 idempotent on replay (dedup by ref=post_id)", c2 == c1,
                      f"before={c1} after_replay={c2}")
                tenant_hw = hp["tenant_id"]
            else:
                check("flow4 homework ping", False, "no homework_post with active section students")
                tenant_hw = None

            # ── Flow 5: exam publish notify + no double ──────────────────────
            term = await conn.fetchrow(
                """
                SELECT et.id, et.tenant_id,
                       (SELECT count(DISTINCT me.student_id) FROM mark_entries me
                          WHERE me.exam_term_id=et.id AND me.tenant_id=et.tenant_id) AS n
                FROM exam_terms et ORDER BY n DESC LIMIT 1
                """
            )
            if term and term["n"] > 0:
                eid = await emit(conn, term["tenant_id"], "EXAM_PUBLISHED",
                                 {"term_id": str(term["id"])})
                created_event_ids.append(eid)
                await worker_main._process_batch(conn)
                c1 = await notif_count(conn, term["tenant_id"], "EXAM_PUBLISHED", term["id"])
                check("flow5 exam publish notifies students with marks",
                      c1 == term["n"], f"notifs={c1} students={term['n']}")
                eid2 = await emit(conn, term["tenant_id"], "EXAM_PUBLISHED",
                                  {"term_id": str(term["id"])})
                created_event_ids.append(eid2)
                await worker_main._process_batch(conn)
                c2 = await notif_count(conn, term["tenant_id"], "EXAM_PUBLISHED", term["id"])
                check("flow5 re-publish creates no duplicate", c2 == c1, f"{c1} → {c2}")
            else:
                check("flow5 exam publish", False, "no exam_term with mark_entries")

            # ── Flow 7: DLQ — poison handler parks, stream continues ─────────
            async def boom(_c, _e):
                raise RuntimeError("synthetic handler failure")
            boom.__name__ = "boom"
            worker_main.HANDLERS["__VERIFY_BOOM__"] = [boom]
            any_tenant = await conn.fetchval("SELECT id FROM tenants LIMIT 1")
            eid = await emit(conn, any_tenant, "__VERIFY_BOOM__", {"x": 1})
            created_event_ids.append(eid)
            await worker_main._process_batch(conn)
            cursor_after = await conn.fetchval("SELECT last_event_id FROM worker_cursors WHERE consumer='main'")
            dlq = await conn.fetchrow(
                "SELECT attempts, resolved_at FROM worker_dlq WHERE event_id=$1 AND handler='boom'", eid)
            check("flow7 poison event → DLQ row, stream advances past it",
                  dlq is not None and cursor_after >= eid,
                  f"dlq={'yes' if dlq else 'no'} cursor={cursor_after} event={eid}")
            del worker_main.HANDLERS["__VERIFY_BOOM__"]

            # ── Flow 6: fee overdue scan + no repeat ─────────────────────────
            led = await conn.fetchrow(
                """
                SELECT fl.id, fl.tenant_id, fl.student_id, fl.period_month, fl.period_year, fl.reminded_at
                FROM fee_ledger fl
                JOIN students st ON st.id=fl.student_id AND st.tenant_id=fl.tenant_id AND st.is_active
                WHERE fl.status='pending' AND fl.period_month IS NOT NULL
                LIMIT 1
                """
            )
            if led:
                # Snapshot every row the scan might stamp so cleanup clears only our delta.
                pre_stamped = {r["id"] for r in await conn.fetch(
                    "SELECT id FROM fee_ledger WHERE reminded_at IS NOT NULL")}
                ledger_restore[led["id"]] = (led["period_year"], led["period_month"], led["reminded_at"])
                # Backdate to guarantee overdue, clear any prior reminder.
                await conn.execute(
                    "UPDATE fee_ledger SET reminded_at=NULL, period_year=$2, period_month=1 WHERE id=$1",
                    led["id"], 2020,
                )
                n1 = await fee_overdue_scan(conn)
                got = await conn.fetchval(
                    "SELECT count(*) FROM notifications WHERE tenant_id=$1 AND type='FEE_OVERDUE' AND ref=$2",
                    led["tenant_id"], str(led["id"]))
                stamped = await conn.fetchval("SELECT reminded_at IS NOT NULL FROM fee_ledger WHERE id=$1", led["id"])
                check("flow6 overdue scan notifies + stamps reminded_at",
                      got == 1 and stamped, f"notif={got} stamped={stamped} scanned={n1}")
                n2 = await fee_overdue_scan(conn)
                got2 = await conn.fetchval(
                    "SELECT count(*) FROM notifications WHERE tenant_id=$1 AND type='FEE_OVERDUE' AND ref=$2",
                    led["tenant_id"], str(led["id"]))
                check("flow6 rescan does not re-remind", got2 == 1, f"still {got2} after rescan")
            else:
                check("flow6 fee overdue scan", False, "no pending monthly fee_ledger row")

            # ── Flow 8: tenant isolation of notifications ────────────────────
            if tenant_hw is not None:
                leak = await conn.fetchval(
                    "SELECT count(*) FROM notifications WHERE type='HOMEWORK' AND ref=$1 AND tenant_id<>$2",
                    str(hp["id"]), tenant_hw)
                check("flow8 notifications never cross tenant", leak == 0, f"cross-tenant rows={leak}")

    finally:
        # ── Cleanup: remove everything this script created ───────────────────
        async with pool.acquire() as conn:
            await conn.execute(
                "DELETE FROM notifications WHERE created_at > NOW() - interval '5 minutes' "
                "AND type IN ('HOMEWORK','EXAM_PUBLISHED','FEE_OVERDUE','FEE_RECEIPT','FEE_RECONCILE','ABSENT')")
            if created_event_ids:
                await conn.execute("DELETE FROM worker_dlq WHERE event_id = ANY($1::bigint[])", created_event_ids)
                await conn.execute("DELETE FROM audit_events WHERE id = ANY($1::bigint[])", created_event_ids)
            # Drop synthetic FEE_OVERDUE_REMINDED audit events from the scans.
            await conn.execute(
                "DELETE FROM audit_events WHERE event_type='FEE_OVERDUE_REMINDED' AND created_at > NOW() - interval '5 minutes'")
            # Clear reminded_at only on rows WE stamped (preserve any pre-existing).
            if pre_stamped:
                await conn.execute(
                    "UPDATE fee_ledger SET reminded_at=NULL WHERE reminded_at IS NOT NULL AND NOT (id = ANY($1::uuid[]))",
                    list(pre_stamped))
            else:
                await conn.execute("UPDATE fee_ledger SET reminded_at=NULL WHERE reminded_at IS NOT NULL")
            # Restore the target row's period + reminder exactly.
            for lid, (py, pm, rem) in ledger_restore.items():
                await conn.execute(
                    "UPDATE fee_ledger SET period_year=$2, period_month=$3, reminded_at=$4 WHERE id=$1",
                    lid, py, pm, rem)
            await conn.execute("UPDATE worker_cursors SET last_event_id=$1 WHERE consumer='main'", start_cursor)
        await pool.close()

    print("\n" + "=" * 56)
    passed = sum(1 for _, ok, _ in results if ok)
    print(f"  {passed}/{len(results)} checks passed")
    print("=" * 56)
    if passed != len(results):
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(run())
