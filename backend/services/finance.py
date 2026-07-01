import io
import uuid
from decimal import Decimal
from typing import Optional

import asyncpg

from core.events import emit
from models.finance import (
    FeeHeadCreate,
    FeeHeadResponse,
    FeeScheduleCreate,
    FeeScheduleResponse,
    GenerateLedgerRequest,
    LedgerEntry,
    MonthYearPair,
    OutstandingReport,
    OutstandingStudent,
    StudentLedger,
)
from services.receipt import period_label


class FinanceError(Exception):
    pass


# ── Fee Heads ────────────────────────────────────────────────────────────────

async def create_fee_head(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, data: FeeHeadCreate
) -> FeeHeadResponse:
    try:
        row = await conn.fetchrow(
            """
            INSERT INTO fee_heads (tenant_id, name, fee_type, sort_order)
            VALUES ($1, $2, $3, $4) RETURNING *
            """,
            tenant_id, data.name, data.fee_type, data.sort_order,
        )
    except asyncpg.UniqueViolationError:
        raise FinanceError("A fee head with this name already exists")
    return FeeHeadResponse(**dict(row))


async def list_fee_heads(
    conn: asyncpg.Connection, tenant_id: uuid.UUID
) -> list[FeeHeadResponse]:
    rows = await conn.fetch(
        "SELECT * FROM fee_heads WHERE tenant_id = $1 ORDER BY sort_order, name",
        tenant_id,
    )
    return [FeeHeadResponse(**dict(r)) for r in rows]


async def toggle_fee_head(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, head_id: uuid.UUID
) -> Optional[FeeHeadResponse]:
    row = await conn.fetchrow(
        "UPDATE fee_heads SET is_active = NOT is_active WHERE id = $1 AND tenant_id = $2 RETURNING *",
        head_id, tenant_id,
    )
    return FeeHeadResponse(**dict(row)) if row else None


# ── Fee Schedules ─────────────────────────────────────────────────────────────

async def upsert_fee_schedule(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, data: FeeScheduleCreate
) -> FeeScheduleResponse:
    row = await conn.fetchrow(
        """
        INSERT INTO fee_schedules
            (tenant_id, fee_head_id, academic_year_id, class_id, amount, due_day_of_month)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (tenant_id, fee_head_id, academic_year_id, class_id)
        DO UPDATE SET amount = EXCLUDED.amount, due_day_of_month = EXCLUDED.due_day_of_month
        RETURNING *
        """,
        tenant_id, data.fee_head_id, data.academic_year_id,
        data.class_id, data.amount, data.due_day_of_month,
    )
    full = await conn.fetchrow(
        """
        SELECT fs.*, fh.name AS fee_head_name, fh.fee_type, c.name AS class_name
        FROM fee_schedules fs
        JOIN fee_heads fh ON fh.id = fs.fee_head_id
        LEFT JOIN classes c ON c.id = fs.class_id
        WHERE fs.id = $1
        """,
        row["id"],
    )
    return FeeScheduleResponse(**dict(full))


async def list_fee_schedules(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, academic_year_id: Optional[uuid.UUID] = None
) -> list[FeeScheduleResponse]:
    rows = await conn.fetch(
        """
        SELECT fs.*, fh.name AS fee_head_name, fh.fee_type, c.name AS class_name
        FROM fee_schedules fs
        JOIN fee_heads fh ON fh.id = fs.fee_head_id
        LEFT JOIN classes c ON c.id = fs.class_id
        WHERE fs.tenant_id = $1
          AND ($2::uuid IS NULL OR fs.academic_year_id = $2::uuid)
        ORDER BY fh.sort_order, fh.name, c.name NULLS FIRST
        """,
        tenant_id, academic_year_id,
    )
    return [FeeScheduleResponse(**dict(r)) for r in rows]


# ── Excel Import ──────────────────────────────────────────────────────────────

async def import_fee_structure_excel(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    academic_year_id: uuid.UUID,
    file_bytes: bytes,
) -> dict:
    """
    Expected columns (case-insensitive): Fee Head | Fee Type | Class | Amount
    Fee Type: monthly / annual / one_time
    Class: exact class name or "ALL" for all classes
    """
    try:
        import openpyxl
    except ImportError:
        raise FinanceError("openpyxl not installed")

    wb = openpyxl.load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
    ws = wb.active

    rows = list(ws.iter_rows(values_only=True))
    if len(rows) < 2:
        raise FinanceError("Excel file must have a header row and at least one data row")

    # Normalise header
    header = [str(h).strip().lower() if h else "" for h in rows[0]]
    required = {"fee head", "fee type", "class", "amount"}
    if not required.issubset(set(header)):
        raise FinanceError(f"Missing columns. Expected: {required}. Found: {set(header)}")

    idx = {name: header.index(name) for name in required}
    filter_col = header.index("student filter") if "student filter" in header else None

    # Cache classes for this tenant
    class_rows = await conn.fetch(
        "SELECT id, name FROM classes WHERE tenant_id = $1", tenant_id
    )
    class_map = {r["name"].strip().lower(): r["id"] for r in class_rows}

    created_heads = skipped_heads = created_schedules = skipped_schedules = 0

    for row_num, row in enumerate(rows[1:], start=2):
        if all(cell is None for cell in row):
            continue
        try:
            head_name = str(row[idx["fee head"]]).strip()
            fee_type  = str(row[idx["fee type"]]).strip().lower()
            class_str = str(row[idx["class"]]).strip()
            amount    = Decimal(str(row[idx["amount"]])).quantize(Decimal("0.01"))
        except Exception as exc:
            raise FinanceError(f"Row {row_num}: parse error — {exc}")

        if fee_type not in ("monthly", "annual", "one_time"):
            raise FinanceError(f"Row {row_num}: invalid fee_type '{fee_type}'")

        student_filter = "all"
        if filter_col is not None and row[filter_col]:
            student_filter = str(row[filter_col]).strip().lower()
        if student_filter not in ("all", "transport", "hosteler"):
            raise FinanceError(f"Row {row_num}: invalid student filter '{student_filter}'. Use: all, transport, hosteler")

        # Upsert fee head
        head_row = await conn.fetchrow(
            """
            INSERT INTO fee_heads (tenant_id, name, fee_type)
            VALUES ($1, $2, $3)
            ON CONFLICT (tenant_id, name)
            DO UPDATE SET fee_type = EXCLUDED.fee_type, is_active = TRUE
            RETURNING id, (xmax = 0) AS inserted
            """,
            tenant_id, head_name, fee_type,
        )
        if head_row["inserted"]:
            created_heads += 1
        else:
            skipped_heads += 1

        class_id = None if class_str.lower() in ("all", "", "none") else class_map.get(class_str.lower())
        if class_str.lower() not in ("all", "", "none") and class_id is None:
            raise FinanceError(f"Row {row_num}: class '{class_str}' not found")

        # Upsert schedule
        sched_row = await conn.fetchrow(
            """
            INSERT INTO fee_schedules
                (tenant_id, fee_head_id, academic_year_id, class_id, amount, student_filter)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (tenant_id, fee_head_id, academic_year_id, class_id)
            DO UPDATE SET amount = EXCLUDED.amount, student_filter = EXCLUDED.student_filter
            RETURNING (xmax = 0) AS inserted
            """,
            tenant_id, head_row["id"], academic_year_id, class_id, amount, student_filter,
        )
        if sched_row["inserted"]:
            created_schedules += 1
        else:
            skipped_schedules += 1

    return {
        "fee_heads_created": created_heads,
        "fee_heads_updated": skipped_heads,
        "schedules_created": created_schedules,
        "schedules_updated": skipped_schedules,
    }


# ── Ledger Generation ─────────────────────────────────────────────────────────

async def generate_ledger(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, data: GenerateLedgerRequest
) -> dict:
    students = await conn.fetch(
        """SELECT id, class_id, is_transport, is_hosteler
           FROM students
           WHERE tenant_id = $1 AND academic_year_id = $2 AND is_active = TRUE""",
        tenant_id, data.academic_year_id,
    )
    if not students:
        return {"created": 0, "skipped": 0, "students": 0}

    schedules = await conn.fetch(
        """
        SELECT fs.*, fh.fee_type, fs.student_filter
        FROM fee_schedules fs
        JOIN fee_heads fh ON fh.id = fs.fee_head_id
        WHERE fs.tenant_id = $1 AND fs.academic_year_id = $2 AND fh.is_active = TRUE
        """,
        tenant_id, data.academic_year_id,
    )

    entries: list[tuple] = []
    for student in students:
        for sched in schedules:
            if sched["class_id"] is not None and sched["class_id"] != student["class_id"]:
                continue

            sf = sched["student_filter"]
            if sf == "transport" and not student["is_transport"]:
                continue
            if sf == "hosteler" and not student["is_hosteler"]:
                continue

            if sched["fee_type"] == "monthly":
                for my in data.month_year_pairs:
                    entries.append((
                        tenant_id, student["id"], sched["fee_head_id"],
                        data.academic_year_id, my.month, my.year, sched["amount"],
                    ))
            elif data.include_annual:
                base_year = data.month_year_pairs[0].year if data.month_year_pairs else 2025
                entries.append((
                    tenant_id, student["id"], sched["fee_head_id"],
                    data.academic_year_id, None, base_year, sched["amount"],
                ))

    if not entries:
        return {"created": 0, "skipped": 0, "students": len(students)}

    before = await conn.fetchval(
        "SELECT COUNT(*) FROM fee_ledger WHERE tenant_id = $1 AND academic_year_id = $2",
        tenant_id, data.academic_year_id,
    )
    await conn.executemany(
        """
        INSERT INTO fee_ledger
            (tenant_id, student_id, fee_head_id, academic_year_id, period_month, period_year, amount_due)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT DO NOTHING
        """,
        entries,
    )
    after = await conn.fetchval(
        "SELECT COUNT(*) FROM fee_ledger WHERE tenant_id = $1 AND academic_year_id = $2",
        tenant_id, data.academic_year_id,
    )
    created = after - before
    return {"created": created, "skipped": len(entries) - created, "students": len(students)}


async def generate_ledger_for_new_student(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    student_id: uuid.UUID,
    academic_year_id: uuid.UUID,
    class_id: uuid.UUID,
    is_transport: bool,
    is_hosteler: bool,
) -> int:
    """Auto-apply fee schedules when a single student is enrolled. Idempotent."""
    schedules = await conn.fetch(
        """
        SELECT fs.*, fh.fee_type, fs.student_filter
        FROM fee_schedules fs
        JOIN fee_heads fh ON fh.id = fs.fee_head_id
        WHERE fs.tenant_id = $1 AND fs.academic_year_id = $2 AND fh.is_active = TRUE
          AND (fs.class_id IS NULL OR fs.class_id = $3)
        """,
        tenant_id, academic_year_id, class_id,
    )
    if not schedules:
        return 0
    pairs = await _derive_month_year_pairs(conn, tenant_id, academic_year_id)
    entries: list[tuple] = []
    for sched in schedules:
        sf = sched["student_filter"]
        if sf == "transport" and not is_transport:
            continue
        if sf == "hosteler" and not is_hosteler:
            continue
        if sched["fee_type"] == "monthly":
            for my in pairs:
                entries.append((tenant_id, student_id, sched["fee_head_id"],
                                 academic_year_id, my.month, my.year, sched["amount"]))
        else:
            base_year = pairs[0].year if pairs else 2025
            entries.append((tenant_id, student_id, sched["fee_head_id"],
                             academic_year_id, None, base_year, sched["amount"]))
    if not entries:
        return 0
    await conn.executemany(
        """INSERT INTO fee_ledger
               (tenant_id, student_id, fee_head_id, academic_year_id, period_month, period_year, amount_due)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING""",
        entries,
    )
    return len(entries)


async def generate_year_ledger(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    academic_year_id: uuid.UUID,
) -> dict:
    """Regenerate ledger for ALL active students in a year (idempotent)."""
    pairs = await _derive_month_year_pairs(conn, tenant_id, academic_year_id)
    return await generate_ledger(
        conn, tenant_id,
        GenerateLedgerRequest(
            academic_year_id=academic_year_id,
            month_year_pairs=pairs,
            include_annual=True,
        ),
    )


async def _derive_month_year_pairs(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, academic_year_id: uuid.UUID
) -> list[MonthYearPair]:
    """Every (month, year) spanned by the academic year's start..end dates."""
    ay = await conn.fetchrow(
        "SELECT start_date, end_date FROM academic_years WHERE id = $1 AND tenant_id = $2",
        academic_year_id, tenant_id,
    )
    if not ay:
        raise FinanceError("Academic year not found")

    pairs: list[MonthYearPair] = []
    y, m = ay["start_date"].year, ay["start_date"].month
    end_y, end_m = ay["end_date"].year, ay["end_date"].month
    while (y, m) <= (end_y, end_m):
        pairs.append(MonthYearPair(month=m, year=y))
        m += 1
        if m > 12:
            m, y = 1, y + 1
    return pairs


async def import_and_generate(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    academic_year_id: uuid.UUID,
    file_bytes: bytes,
) -> dict:
    """Single accountant action: import the structure Excel AND apply it to every
    student for the whole academic year, atomically. This is the only supported
    way to set up fees — no manual head/schedule entry."""
    async with conn.transaction():
        structure = await import_fee_structure_excel(
            conn, tenant_id, academic_year_id, file_bytes
        )
        pairs = await _derive_month_year_pairs(conn, tenant_id, academic_year_id)
        ledger = await generate_ledger(
            conn,
            tenant_id,
            GenerateLedgerRequest(
                academic_year_id=academic_year_id,
                month_year_pairs=pairs,
                include_annual=True,
            ),
        )
    return {
        **structure,
        "ledger_entries_created": ledger["created"],
        "ledger_entries_existing": ledger["skipped"],
        "students_affected": ledger["students"],
    }


# ── Ledger Queries ────────────────────────────────────────────────────────────

async def get_student_ledger(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, student_id: uuid.UUID
) -> StudentLedger:
    student = await conn.fetchrow(
        """
        SELECT s.first_name, s.last_name, s.admission_no, c.name AS class_name, sec.name AS section_name
        FROM students s
        JOIN classes c ON c.id = s.class_id
        JOIN sections sec ON sec.id = s.section_id
        WHERE s.id = $1 AND s.tenant_id = $2
        """,
        student_id, tenant_id,
    )
    if not student:
        raise FinanceError("Student not found")

    rows = await conn.fetch(
        """
        SELECT fl.*, fh.name AS fee_head_name, fh.fee_type
        FROM fee_ledger fl
        JOIN fee_heads fh ON fh.id = fl.fee_head_id
        WHERE fl.student_id = $1 AND fl.tenant_id = $2
        ORDER BY fl.period_year, fl.period_month NULLS FIRST, fh.sort_order
        """,
        student_id, tenant_id,
    )

    entries = [LedgerEntry(**dict(r)) for r in rows]
    pending = [e for e in entries if e.status in ("pending", "due", "overdue")]
    paid    = [e for e in entries if e.status == "paid"]

    return StudentLedger(
        student_id=student_id,
        student_name=f"{student['first_name']} {student['last_name']}",
        admission_no=student["admission_no"],
        class_section=f"{student['class_name']} - {student['section_name']}",
        pending=pending,
        paid=paid,
        total_pending=sum(e.amount_due for e in pending),
        total_paid=sum(e.amount_due for e in paid),
    )


async def get_outstanding_dues(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    class_id: Optional[uuid.UUID] = None,
    section_id: Optional[uuid.UUID] = None,
    academic_year_id: Optional[uuid.UUID] = None,
    limit: int = 200,
    offset: int = 0,
) -> OutstandingReport:
    rows = await conn.fetch(
        """
        SELECT
            s.id            AS student_id,
            s.first_name || ' ' || s.last_name AS student_name,
            s.admission_no,
            s.roll_number,
            c.name          AS class_name,
            sec.name        AS section_name,
            SUM(fl.amount_due)::numeric  AS total_due,
            COUNT(fl.id)::int            AS pending_entries
        FROM fee_ledger fl
        JOIN students s   ON s.id = fl.student_id
        JOIN classes c    ON c.id = s.class_id
        JOIN sections sec ON sec.id = s.section_id
        WHERE fl.tenant_id = $1 AND fl.status IN ('pending', 'due', 'overdue')
          AND ($2::uuid IS NULL OR s.class_id = $2::uuid)
          AND ($3::uuid IS NULL OR s.section_id = $3::uuid)
          AND ($4::uuid IS NULL OR fl.academic_year_id = $4::uuid)
        GROUP BY s.id, s.first_name, s.last_name, s.admission_no, s.roll_number, c.name, sec.name
        ORDER BY c.name, sec.name,
            CASE WHEN s.roll_number ~ '^[0-9]+$' THEN LPAD(s.roll_number, 10, '0') ELSE s.roll_number END
        LIMIT $5 OFFSET $6
        """,
        tenant_id, class_id, section_id, academic_year_id, limit, offset,
    )
    items = [OutstandingStudent(**dict(r)) for r in rows]
    grand_total = sum(i.total_due for i in items)
    return OutstandingReport(items=items, grand_total=grand_total, student_count=len(items))


async def get_payment_logs(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    limit: int = 100,
    offset: int = 0,
) -> list[dict]:
    rows = await conn.fetch(
        """
        SELECT fp.*, s.first_name || ' ' || s.last_name AS student_name, s.admission_no
        FROM fee_payments fp
        JOIN students s ON s.id = fp.student_id
        WHERE fp.tenant_id = $1
        ORDER BY fp.created_at DESC
        LIMIT $2 OFFSET $3
        """,
        tenant_id, limit, offset,
    )
    return [dict(r) for r in rows]
