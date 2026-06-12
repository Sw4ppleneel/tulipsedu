import io
import uuid
from datetime import time
from typing import Optional

import asyncpg

from models.timetable import DAY_NAMES, SlotResponse, SlotUpsert, WeeklyTimetable


def _parse_time(t: str) -> time:
    h, m = t.split(":")
    return time(int(h), int(m))


def _to_slot(r: asyncpg.Record) -> SlotResponse:
    d = dict(r)
    d["start_time"] = str(d["start_time"])
    d["end_time"]   = str(d["end_time"])
    d["day_name"]   = DAY_NAMES.get(d["day_of_week"])
    return SlotResponse(**d)


async def upsert_slot(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, data: SlotUpsert
) -> SlotResponse:
    row = await conn.fetchrow(
        """
        INSERT INTO timetable_slots
            (tenant_id, academic_year_id, class_id, section_id,
             day_of_week, period_number, start_time, end_time,
             subject, staff_id, room)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (tenant_id, academic_year_id, class_id, section_id, day_of_week, period_number)
        DO UPDATE SET
            start_time = EXCLUDED.start_time,
            end_time   = EXCLUDED.end_time,
            subject    = EXCLUDED.subject,
            staff_id   = EXCLUDED.staff_id,
            room       = EXCLUDED.room
        RETURNING *
        """,
        tenant_id, data.academic_year_id, data.class_id, data.section_id,
        data.day_of_week, data.period_number,
        _parse_time(data.start_time), _parse_time(data.end_time),
        data.subject, data.staff_id, data.room,
    )
    full = await conn.fetchrow(
        """
        SELECT ts.*, sf.first_name || ' ' || sf.last_name AS staff_name
        FROM timetable_slots ts
        LEFT JOIN staff sf ON sf.id = ts.staff_id
        WHERE ts.id = $1
        """,
        row["id"],
    )
    return _to_slot(full)


async def delete_slot(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    academic_year_id: uuid.UUID,
    class_id: uuid.UUID,
    section_id: uuid.UUID,
    day_of_week: int,
    period_number: int,
) -> bool:
    result = await conn.execute(
        """
        DELETE FROM timetable_slots
        WHERE tenant_id=$1 AND academic_year_id=$2 AND class_id=$3
          AND section_id=$4 AND day_of_week=$5 AND period_number=$6
        """,
        tenant_id, academic_year_id, class_id, section_id, day_of_week, period_number,
    )
    return result == "DELETE 1"


async def get_weekly_timetable(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    academic_year_id: uuid.UUID,
    class_id: uuid.UUID,
    section_id: uuid.UUID,
) -> WeeklyTimetable:
    meta = await conn.fetchrow(
        """
        SELECT c.name AS class_name, sec.name AS section_name
        FROM classes c, sections sec
        WHERE c.id = $1 AND sec.id = $2
        """,
        class_id, section_id,
    )
    rows = await conn.fetch(
        """
        SELECT ts.*, sf.first_name || ' ' || sf.last_name AS staff_name
        FROM timetable_slots ts
        LEFT JOIN staff sf ON sf.id = ts.staff_id
        WHERE ts.tenant_id = $1 AND ts.academic_year_id = $2
          AND ts.class_id = $3 AND ts.section_id = $4
        ORDER BY ts.day_of_week, ts.period_number
        """,
        tenant_id, academic_year_id, class_id, section_id,
    )
    return WeeklyTimetable(
        class_id=class_id,
        section_id=section_id,
        academic_year_id=academic_year_id,
        class_name=meta["class_name"] if meta else "",
        section_name=meta["section_name"] if meta else "",
        slots=[_to_slot(r) for r in rows],
    )


async def get_staff_timetable(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    academic_year_id: uuid.UUID,
    staff_id: uuid.UUID,
) -> list[SlotResponse]:
    rows = await conn.fetch(
        """
        SELECT ts.*, sf.first_name || ' ' || sf.last_name AS staff_name,
               c.name AS class_name_ctx, sec.name AS section_name_ctx
        FROM timetable_slots ts
        LEFT JOIN staff sf ON sf.id = ts.staff_id
        LEFT JOIN classes c ON c.id = ts.class_id
        LEFT JOIN sections sec ON sec.id = ts.section_id
        WHERE ts.tenant_id = $1 AND ts.academic_year_id = $2 AND ts.staff_id = $3
        ORDER BY ts.day_of_week, ts.period_number
        """,
        tenant_id, academic_year_id, staff_id,
    )
    return [_to_slot(r) for r in rows]


# ── Bulk Import ───────────────────────────────────────────────────────────────

class TimetableError(Exception):
    pass


_DAY_MAP = {
    "monday": 1, "tuesday": 2, "wednesday": 3,
    "thursday": 4, "friday": 5, "saturday": 6,
    "mon": 1, "tue": 2, "wed": 3, "thu": 4, "fri": 5, "sat": 6,
    "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6,
}


async def import_timetable(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    academic_year_id: uuid.UUID,
    file_bytes: bytes,
) -> dict:
    try:
        import openpyxl
    except ImportError:
        raise TimetableError("openpyxl not installed on server")

    wb = openpyxl.load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if len(rows) < 2:
        raise TimetableError("File must have a header row and at least one data row")

    header = [str(h).strip().lower() if h is not None else "" for h in rows[0]]
    required = {"class", "section", "day", "period", "start time", "end time", "subject"}
    missing = required - set(header)
    if missing:
        raise TimetableError(f"Missing columns: {missing}")

    idx = {name: header.index(name) for name in required}
    opt_idx = {col: header.index(col) for col in ("employee no", "room") if col in header}

    class_rows = await conn.fetch("SELECT id, name FROM classes WHERE tenant_id = $1", tenant_id)
    class_map = {r["name"].strip().lower(): r["id"] for r in class_rows}

    sec_rows = await conn.fetch(
        """SELECT s.id, s.name, c.name AS cn
           FROM sections s JOIN classes c ON c.id = s.class_id
           WHERE s.tenant_id = $1""",
        tenant_id,
    )
    section_map = {(r["cn"].strip().lower(), r["name"].strip().lower()): r["id"] for r in sec_rows}

    staff_rows = await conn.fetch(
        "SELECT id, employee_no FROM staff WHERE tenant_id = $1 AND is_active = TRUE", tenant_id
    )
    staff_map = {r["employee_no"].strip().lower(): r["id"] for r in staff_rows}

    created = updated = 0
    errors: list[str] = []

    def _pt(s: str) -> time:
        h, m = str(s).strip().split(":")
        return time(int(h), int(m))

    for row_num, row in enumerate(rows[1:], start=2):
        if all(cell is None for cell in row):
            continue
        try:
            class_str   = str(row[idx["class"]]).strip()
            section_str = str(row[idx["section"]]).strip()
            day_str     = str(row[idx["day"]]).strip().lower()
            period      = int(row[idx["period"]])
            start_t     = _pt(row[idx["start time"]])
            end_t       = _pt(row[idx["end time"]])
            subject     = str(row[idx["subject"]]).strip()

            staff_id = room = None
            if "employee no" in opt_idx:
                v = row[opt_idx["employee no"]]
                if v:
                    staff_id = staff_map.get(str(v).strip().lower())
                    if not staff_id:
                        raise ValueError(f"Employee '{v}' not found")
            if "room" in opt_idx:
                v = row[opt_idx["room"]]
                if v: room = str(v).strip()

            class_id = class_map.get(class_str.lower())
            if not class_id:
                raise ValueError(f"Class '{class_str}' not found")

            section_id = section_map.get((class_str.lower(), section_str.lower()))
            if not section_id:
                raise ValueError(f"Section '{section_str}' not found for class '{class_str}'")

            day = _DAY_MAP.get(day_str)
            if not day:
                raise ValueError(f"Invalid day '{day_str}'. Use Monday–Saturday")

            result = await conn.fetchrow(
                """
                INSERT INTO timetable_slots
                    (tenant_id, academic_year_id, class_id, section_id,
                     day_of_week, period_number, start_time, end_time,
                     subject, staff_id, room)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                ON CONFLICT (tenant_id, academic_year_id, class_id, section_id, day_of_week, period_number)
                DO UPDATE SET
                    start_time = EXCLUDED.start_time,
                    end_time   = EXCLUDED.end_time,
                    subject    = EXCLUDED.subject,
                    staff_id   = EXCLUDED.staff_id,
                    room       = EXCLUDED.room
                RETURNING (xmax = 0) AS inserted
                """,
                tenant_id, academic_year_id, class_id, section_id,
                day, period, start_t, end_t, subject, staff_id, room,
            )
            if result["inserted"]:
                created += 1
            else:
                updated += 1

        except Exception as exc:
            errors.append(f"Row {row_num}: {exc}")

    return {"created": created, "updated": updated, "errors": errors}
