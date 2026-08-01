import io
import uuid
from decimal import Decimal
from typing import Optional

import asyncpg

from core.events import emit
from models.finance import (
    DiscountItem,
    FeeHeadCreate,
    FeeHeadResponse,
    FeeScheduleCreate,
    FeeScheduleResponse,
    GenerateLedgerRequest,
    LedgerEntry,
    MonthYearPair,
    OutstandingReport,
    OutstandingStudent,
    StudentDiscountResponse,
    StudentLedger,
)
from services.receipt import period_label


class FinanceError(Exception):
    pass


# ── Fee Heads ────────────────────────────────────────────────────────────────

async def create_fee_head(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, data: FeeHeadCreate,
    created_by: Optional[uuid.UUID] = None,
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
    await emit(conn, "FEE_HEAD_CREATED", tenant_id, {
        "fee_head_id": str(row["id"]), "name": data.name, "fee_type": data.fee_type,
        "created_by": str(created_by) if created_by else None,
    })
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
    conn: asyncpg.Connection, tenant_id: uuid.UUID, head_id: uuid.UUID,
    toggled_by: Optional[uuid.UUID] = None,
) -> Optional[FeeHeadResponse]:
    row = await conn.fetchrow(
        "UPDATE fee_heads SET is_active = NOT is_active WHERE id = $1 AND tenant_id = $2 RETURNING *",
        head_id, tenant_id,
    )
    if not row:
        return None
    await emit(conn, "FEE_HEAD_TOGGLED", tenant_id, {
        "fee_head_id": str(head_id), "is_active": row["is_active"],
        "toggled_by": str(toggled_by) if toggled_by else None,
    })
    return FeeHeadResponse(**dict(row))


# ── Fee Schedules ─────────────────────────────────────────────────────────────

async def upsert_fee_schedule(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, data: FeeScheduleCreate,
    set_by: Optional[uuid.UUID] = None,
) -> FeeScheduleResponse:
    if data.class_id is None:
        row = await conn.fetchrow(
            """
            INSERT INTO fee_schedules
                (tenant_id, fee_head_id, academic_year_id, class_id, amount, due_day_of_month,
                 reduced_month, reduced_percentage)
            VALUES ($1, $2, $3, NULL, $4, $5, $6, $7)
            ON CONFLICT (tenant_id, fee_head_id, academic_year_id) WHERE class_id IS NULL
            DO UPDATE SET amount = EXCLUDED.amount, due_day_of_month = EXCLUDED.due_day_of_month,
                          reduced_month = EXCLUDED.reduced_month, reduced_percentage = EXCLUDED.reduced_percentage
            RETURNING *
            """,
            tenant_id, data.fee_head_id, data.academic_year_id,
            data.amount, data.due_day_of_month, data.reduced_month, data.reduced_percentage,
        )
    else:
        row = await conn.fetchrow(
            """
            INSERT INTO fee_schedules
                (tenant_id, fee_head_id, academic_year_id, class_id, amount, due_day_of_month,
                 reduced_month, reduced_percentage)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (tenant_id, fee_head_id, academic_year_id, class_id) WHERE class_id IS NOT NULL
            DO UPDATE SET amount = EXCLUDED.amount, due_day_of_month = EXCLUDED.due_day_of_month,
                          reduced_month = EXCLUDED.reduced_month, reduced_percentage = EXCLUDED.reduced_percentage
            RETURNING *
            """,
            tenant_id, data.fee_head_id, data.academic_year_id,
            data.class_id, data.amount, data.due_day_of_month, data.reduced_month, data.reduced_percentage,
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
    await emit(conn, "FEE_SCHEDULE_SET", tenant_id, {
        "schedule_id": str(row["id"]), "fee_head_id": str(data.fee_head_id),
        "amount": str(data.amount), "class_id": str(data.class_id) if data.class_id else None,
        "set_by": str(set_by) if set_by else None,
    })
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
    imported_by: Optional[uuid.UUID] = None,
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

        # Upsert schedule — two partial indexes handle NULL vs non-NULL class_id
        # (PostgreSQL B-tree: NULL != NULL, so a single index on class_id can't
        # deduplicate ALL-classes rows; we target the right partial index instead).
        if class_id is None:
            sched_row = await conn.fetchrow(
                """
                INSERT INTO fee_schedules
                    (tenant_id, fee_head_id, academic_year_id, class_id, amount, student_filter)
                VALUES ($1, $2, $3, NULL, $4, $5)
                ON CONFLICT (tenant_id, fee_head_id, academic_year_id) WHERE class_id IS NULL
                DO UPDATE SET amount = EXCLUDED.amount, student_filter = EXCLUDED.student_filter
                RETURNING (xmax = 0) AS inserted
                """,
                tenant_id, head_row["id"], academic_year_id, amount, student_filter,
            )
        else:
            sched_row = await conn.fetchrow(
                """
                INSERT INTO fee_schedules
                    (tenant_id, fee_head_id, academic_year_id, class_id, amount, student_filter)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (tenant_id, fee_head_id, academic_year_id, class_id) WHERE class_id IS NOT NULL
                DO UPDATE SET amount = EXCLUDED.amount, student_filter = EXCLUDED.student_filter
                RETURNING (xmax = 0) AS inserted
                """,
                tenant_id, head_row["id"], academic_year_id, class_id, amount, student_filter,
            )
        if sched_row["inserted"]:
            created_schedules += 1
        else:
            skipped_schedules += 1

    await emit(conn, "FEE_STRUCTURE_IMPORTED", tenant_id, {
        "academic_year_id": str(academic_year_id),
        "fee_heads_created": created_heads, "fee_heads_updated": skipped_heads,
        "schedules_created": created_schedules, "schedules_updated": skipped_schedules,
        "imported_by": str(imported_by) if imported_by else None,
    })
    return {
        "fee_heads_created": created_heads,
        "fee_heads_updated": skipped_heads,
        "schedules_created": created_schedules,
        "schedules_updated": skipped_schedules,
    }


# ── Student fee discounts (sibling concessions etc.) ─────────────────────────

_CENT = Decimal("0.01")


def _discounted(amount: Decimal, pct: Optional[Decimal]) -> Decimal:
    if not pct:
        return amount
    return (amount * (Decimal(100) - pct) / Decimal(100)).quantize(_CENT)


def _monthly_amount(sched, month: int, discount_pct: Optional[Decimal]) -> Decimal:
    """A schedule's amount for one specific calendar month, applying its
    optional seasonal reduction (e.g. DPS's May transport fee = 50%) before
    the student's own sibling/concession discount — the two stack, so a
    discounted transport student still gets the May reduction on top."""
    base = sched["amount"]
    if sched["reduced_month"] and sched["reduced_month"] == month:
        base = (base * sched["reduced_percentage"] / Decimal(100)).quantize(_CENT)
    return _discounted(base, discount_pct)


async def _load_discount_map(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, student_id: Optional[uuid.UUID] = None
) -> dict[tuple[uuid.UUID, uuid.UUID], Decimal]:
    """(student_id, fee_head_id) → percentage, for ledger generation."""
    if student_id:
        rows = await conn.fetch(
            "SELECT student_id, fee_head_id, percentage FROM student_fee_discounts"
            " WHERE tenant_id = $1 AND student_id = $2",
            tenant_id, student_id,
        )
    else:
        rows = await conn.fetch(
            "SELECT student_id, fee_head_id, percentage FROM student_fee_discounts"
            " WHERE tenant_id = $1",
            tenant_id,
        )
    return {(r["student_id"], r["fee_head_id"]): r["percentage"] for r in rows}


async def list_student_discounts(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, student_id: uuid.UUID
) -> list[StudentDiscountResponse]:
    rows = await conn.fetch(
        """
        SELECT d.fee_head_id, fh.name AS fee_head_name, d.percentage, d.reason
        FROM student_fee_discounts d
        JOIN fee_heads fh ON fh.id = d.fee_head_id
        WHERE d.tenant_id = $1 AND d.student_id = $2
        ORDER BY fh.sort_order, fh.name
        """,
        tenant_id, student_id,
    )
    return [StudentDiscountResponse(**dict(r)) for r in rows]


async def set_student_discounts(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    student_id: uuid.UUID,
    items: list[DiscountItem],
    reason: str = "sibling",
) -> dict:
    """Replace the student's discount set and recompute their unpaid ledger rows.

    Recomputation always starts from the fee-schedule base amount, so repeated
    edits never compound. Only pending/due/overdue rows that map to a schedule
    are touched — paid/waived rows and carried-forward arrears (no schedule in
    their year) stay untouched. When the same fee head has both a class-specific
    and an all-classes schedule, the class-specific amount wins (same precedence
    as generation)."""
    async with conn.transaction():
        student = await conn.fetchrow(
            "SELECT class_id FROM students WHERE id = $1 AND tenant_id = $2 AND is_active = TRUE",
            student_id, tenant_id,
        )
        if not student:
            raise FinanceError("Student not found")

        await conn.execute(
            "DELETE FROM student_fee_discounts WHERE tenant_id = $1 AND student_id = $2",
            tenant_id, student_id,
        )
        if items:
            await conn.executemany(
                """
                INSERT INTO student_fee_discounts
                    (tenant_id, student_id, fee_head_id, percentage, reason, created_by)
                VALUES ($1, $2, $3, $4, $5, $6)
                """,
                [
                    (tenant_id, student_id, it.fee_head_id, it.percentage,
                     (reason or "sibling").strip()[:100] or "sibling", user_id)
                    for it in items
                ],
            )

        result = await conn.execute(
            """
            UPDATE fee_ledger fl
            SET amount_due = ROUND(
                (CASE
                    WHEN s.reduced_month IS NOT NULL AND s.reduced_month = fl.period_month
                    THEN ROUND(s.amount * s.reduced_percentage / 100, 2)
                    ELSE s.amount
                 END) * (100 - COALESCE(d.percentage, 0)) / 100, 2)
            FROM (
                SELECT DISTINCT ON (fee_head_id, academic_year_id)
                       fee_head_id, academic_year_id, amount, reduced_month, reduced_percentage
                FROM fee_schedules
                WHERE tenant_id = $1 AND (class_id IS NULL OR class_id = $3)
                ORDER BY fee_head_id, academic_year_id, class_id NULLS LAST
            ) s
            LEFT JOIN student_fee_discounts d
                   ON d.tenant_id = $1 AND d.student_id = $2 AND d.fee_head_id = s.fee_head_id
            WHERE fl.tenant_id = $1 AND fl.student_id = $2
              AND fl.status IN ('pending', 'due', 'overdue')
              AND fl.fee_head_id = s.fee_head_id
              AND fl.academic_year_id = s.academic_year_id
            """,
            tenant_id, student_id, student["class_id"],
        )
        rows_updated = int(result.split()[-1])

        await emit(conn, "STUDENT_DISCOUNT_SET", tenant_id, {
            "student_id": str(student_id),
            "discounts": [
                {"fee_head_id": str(it.fee_head_id), "percentage": str(it.percentage)}
                for it in items
            ],
            "rows_updated": rows_updated,
            "set_by": str(user_id),
        })

    return {
        "discounts": len(items),
        "ledger_rows_updated": rows_updated,
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

    discounts = await _load_discount_map(conn, tenant_id)

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

            discount_pct = discounts.get((student["id"], sched["fee_head_id"]))
            if sched["fee_type"] == "monthly":
                for my in data.month_year_pairs:
                    entries.append((
                        tenant_id, student["id"], sched["fee_head_id"],
                        data.academic_year_id, my.month, my.year,
                        _monthly_amount(sched, my.month, discount_pct),
                    ))
            elif data.include_annual:
                base_year = data.month_year_pairs[0].year if data.month_year_pairs else 2025
                entries.append((
                    tenant_id, student["id"], sched["fee_head_id"],
                    data.academic_year_id, None, base_year, _discounted(sched["amount"], discount_pct),
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
    discounts = await _load_discount_map(conn, tenant_id, student_id)
    entries: list[tuple] = []
    for sched in schedules:
        sf = sched["student_filter"]
        if sf == "transport" and not is_transport:
            continue
        if sf == "hosteler" and not is_hosteler:
            continue
        discount_pct = discounts.get((student_id, sched["fee_head_id"]))
        if sched["fee_type"] == "monthly":
            for my in pairs:
                entries.append((tenant_id, student_id, sched["fee_head_id"],
                                 academic_year_id, my.month, my.year,
                                 _monthly_amount(sched, my.month, discount_pct)))
        else:
            base_year = pairs[0].year if pairs else 2025
            entries.append((tenant_id, student_id, sched["fee_head_id"],
                             academic_year_id, None, base_year, _discounted(sched["amount"], discount_pct)))
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
    imported_by: Optional[uuid.UUID] = None,
) -> dict:
    """Single accountant action: import the structure Excel AND apply it to every
    student for the whole academic year, atomically. This is the only supported
    way to set up fees — no manual head/schedule entry."""
    async with conn.transaction():
        structure = await import_fee_structure_excel(
            conn, tenant_id, academic_year_id, file_bytes, imported_by=imported_by
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

    # Grand total / student count must reflect ALL matching students, not just
    # the current page — computed separately so LIMIT/OFFSET above can't
    # silently under-report them (this previously summed only the page,
    # causing the report's total to disagree with the dashboard's).
    totals = await conn.fetchrow(
        """
        SELECT
            COALESCE(SUM(fl.amount_due), 0)::numeric AS grand_total,
            COUNT(DISTINCT fl.student_id)::int        AS student_count
        FROM fee_ledger fl
        JOIN students s ON s.id = fl.student_id
        WHERE fl.tenant_id = $1 AND fl.status IN ('pending', 'due', 'overdue')
          AND ($2::uuid IS NULL OR s.class_id = $2::uuid)
          AND ($3::uuid IS NULL OR s.section_id = $3::uuid)
          AND ($4::uuid IS NULL OR fl.academic_year_id = $4::uuid)
        """,
        tenant_id, class_id, section_id, academic_year_id,
    )
    return OutstandingReport(
        items=items, grand_total=totals["grand_total"], student_count=totals["student_count"],
    )


async def count_payment_logs(conn: asyncpg.Connection, tenant_id: uuid.UUID) -> int:
    """Total payment rows for the tenant, ignoring LIMIT/OFFSET.

    Kept separate from get_payment_logs so the CSV export can keep using the
    plain row list. Mirrors the JOIN in get_payment_logs: a payment whose
    student row is gone would be absent from the page, so counting the bare
    fee_payments table would over-report and leave the last page short.
    """
    return await conn.fetchval(
        """
        SELECT COUNT(*)::int
        FROM fee_payments fp
        JOIN students s ON s.id = fp.student_id
        WHERE fp.tenant_id = $1
        """,
        tenant_id,
    )


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
        ORDER BY fp.created_at DESC, fp.id DESC
        LIMIT $2 OFFSET $3
        """,
        tenant_id, limit, offset,
    )
    return [dict(r) for r in rows]
