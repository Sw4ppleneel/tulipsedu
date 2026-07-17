import io
import uuid
from datetime import date, datetime
from typing import Optional

import asyncpg

from core.events import emit
from services.finance import generate_ledger_for_new_student, generate_year_ledger
from models.student import (
    AcademicYearCreate,
    AcademicYearResponse,
    ClassCreate,
    ClassResponse,
    SectionCreate,
    SectionResponse,
    StudentCreate,
    StudentListResponse,
    StudentResponse,
    StudentUpdate,
)


class StudentError(Exception):
    pass


# ── Academic Years ────────────────────────────────────────────────────────────

async def create_academic_year(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, data: AcademicYearCreate
) -> AcademicYearResponse:
    row = await conn.fetchrow(
        """
        INSERT INTO academic_years (tenant_id, name, start_date, end_date)
        VALUES ($1, $2, $3, $4)
        RETURNING *
        """,
        tenant_id, data.name, data.start_date, data.end_date,
    )
    return AcademicYearResponse(**dict(row))


async def list_academic_years(
    conn: asyncpg.Connection, tenant_id: uuid.UUID
) -> list[AcademicYearResponse]:
    rows = await conn.fetch(
        "SELECT * FROM academic_years WHERE tenant_id = $1 ORDER BY start_date DESC",
        tenant_id,
    )
    return [AcademicYearResponse(**dict(r)) for r in rows]


async def set_current_year(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, year_id: uuid.UUID
) -> AcademicYearResponse:
    async with conn.transaction():
        await conn.execute(
            "UPDATE academic_years SET is_current = FALSE WHERE tenant_id = $1",
            tenant_id,
        )
        row = await conn.fetchrow(
            "UPDATE academic_years SET is_current = TRUE WHERE id = $1 AND tenant_id = $2 RETURNING *",
            year_id, tenant_id,
        )
    if not row:
        raise StudentError("Academic year not found")
    return AcademicYearResponse(**dict(row))


async def rollover_academic_year(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    from_year_id: uuid.UUID,
    to_year_id: uuid.UUID,
    user_id: uuid.UUID,
) -> dict:
    """
    Orchestrated academic-year rollover inside a single transaction.

    Steps:
    1. Validate: from_year is active+current, to_year exists, no existing rollover
    2. Carry forward pending/due/overdue fee ledger rows into the new year as 'pending'
    3. Clone timetable slots (not published) into the new year
    4. Archive the old year; set the new year as current
    5. Emit ACADEMIC_YEAR_ROLLED_OVER

    Graduating-class promotion (increment class) is intentionally NOT done
    automatically — class assignments in rural India require manual principal
    oversight (failures, TC cases, special repeat students).
    """
    async with conn.transaction():
        from_year = await conn.fetchrow(
            "SELECT * FROM academic_years WHERE id=$1 AND tenant_id=$2 FOR UPDATE",
            from_year_id, tenant_id,
        )
        if not from_year:
            raise StudentError("Source academic year not found")
        if from_year["status"] != "active":
            raise StudentError("Source year is already archived")
        if not from_year["is_current"]:
            raise StudentError("Source year is not the current year")

        to_year = await conn.fetchrow(
            "SELECT * FROM academic_years WHERE id=$1 AND tenant_id=$2 FOR UPDATE",
            to_year_id, tenant_id,
        )
        if not to_year:
            raise StudentError("Target academic year not found")
        if to_year["status"] == "archived":
            raise StudentError("Target year is already archived")

        # Step 1: carry forward unpaid fee ledger rows
        carried = await conn.execute(
            """
            INSERT INTO fee_ledger
              (tenant_id, student_id, fee_head_id, fee_schedule_id, academic_year_id,
               amount_due, period_month, period_year, status, due_date)
            SELECT tenant_id, student_id, fee_head_id, fee_schedule_id, $2,
                   amount_due, period_month, period_year, 'pending', due_date
            FROM fee_ledger
            WHERE tenant_id = $1
              AND academic_year_id = $3
              AND status IN ('pending', 'due', 'overdue')
            ON CONFLICT DO NOTHING
            """,
            tenant_id, to_year_id, from_year_id,
        )

        # Step 2: clone timetable slots (unpublished; teacher assignments preserved)
        slots_cloned = await conn.execute(
            """
            INSERT INTO timetable_slots
              (tenant_id, academic_year_id, class_id, section_id, staff_id,
               day_of_week, period_number, subject, start_time, end_time)
            SELECT tenant_id, $2, class_id, section_id, staff_id,
                   day_of_week, period_number, subject, start_time, end_time
            FROM timetable_slots
            WHERE tenant_id = $1 AND academic_year_id = $3
            ON CONFLICT DO NOTHING
            """,
            tenant_id, to_year_id, from_year_id,
        )

        # Step 3: archive old year, set new year as current
        await conn.execute(
            "UPDATE academic_years SET status='archived', is_current=FALSE WHERE id=$1 AND tenant_id=$2",
            from_year_id, tenant_id,
        )
        updated = await conn.fetchrow(
            "UPDATE academic_years SET is_current=TRUE WHERE id=$1 AND tenant_id=$2 RETURNING *",
            to_year_id, tenant_id,
        )

        # Step 4: emit audit event
        await emit(conn, "ACADEMIC_YEAR_ROLLED_OVER", tenant_id, {
            "from_year_id": str(from_year_id),
            "to_year_id": str(to_year_id),
            "from_year_name": from_year["name"],
            "to_year_name": to_year["name"],
            "initiated_by": str(user_id),
        })

    ledger_rows = int((carried or "0 0").split()[-1])
    slot_rows = int((slots_cloned or "0 0").split()[-1])

    return {
        "archived_year": from_year["name"],
        "new_current_year": updated["name"] if updated else to_year["name"],
        "fee_rows_carried": ledger_rows,
        "timetable_slots_cloned": slot_rows,
    }


# ── Classes & Sections ────────────────────────────────────────────────────────

async def create_class(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, data: ClassCreate
) -> ClassResponse:
    try:
        row = await conn.fetchrow(
            "INSERT INTO classes (tenant_id, name, numeric_order) VALUES ($1, $2, $3) RETURNING *",
            tenant_id, data.name, data.numeric_order,
        )
    except asyncpg.UniqueViolationError:
        raise StudentError("A class with this name already exists")
    return ClassResponse(**dict(row))


async def list_classes(
    conn: asyncpg.Connection, tenant_id: uuid.UUID
) -> list[ClassResponse]:
    rows = await conn.fetch(
        """
        SELECT
            c.id        AS class_id,
            c.tenant_id AS class_tenant_id,
            c.name      AS class_name,
            c.numeric_order,
            s.id        AS section_id,
            s.name      AS section_name
        FROM classes c
        LEFT JOIN sections s ON s.class_id = c.id AND s.tenant_id = c.tenant_id
        WHERE c.tenant_id = $1
        ORDER BY c.numeric_order NULLS LAST, c.name, s.name
        """,
        tenant_id,
    )

    classes: dict[uuid.UUID, ClassResponse] = {}
    for r in rows:
        cid = r["class_id"]
        if cid not in classes:
            classes[cid] = ClassResponse(
                id=cid,
                tenant_id=r["class_tenant_id"],
                name=r["class_name"],
                numeric_order=r["numeric_order"],
                sections=[],
            )
        if r["section_id"] is not None:
            classes[cid].sections.append(
                SectionResponse(
                    id=r["section_id"],
                    tenant_id=tenant_id,
                    class_id=cid,
                    name=r["section_name"],
                )
            )
    return list(classes.values())


async def create_section(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    class_id: uuid.UUID,
    data: SectionCreate,
) -> SectionResponse:
    class_exists = await conn.fetchval(
        "SELECT 1 FROM classes WHERE id = $1 AND tenant_id = $2", class_id, tenant_id
    )
    if not class_exists:
        raise StudentError("Class not found")
    try:
        row = await conn.fetchrow(
            "INSERT INTO sections (tenant_id, class_id, name) VALUES ($1, $2, $3) RETURNING *",
            tenant_id, class_id, data.name,
        )
    except asyncpg.UniqueViolationError:
        raise StudentError("A section with this name already exists in this class")
    return SectionResponse(**dict(row))


# ── Students ──────────────────────────────────────────────────────────────────

_STUDENT_JOIN = """
    SELECT
        s.*,
        c.name   AS class_name,
        sec.name AS section_name,
        ay.name  AS academic_year_name
    FROM students s
    JOIN classes        c   ON c.id   = s.class_id
    JOIN sections       sec ON sec.id = s.section_id
    JOIN academic_years ay  ON ay.id  = s.academic_year_id
"""

_ROLL_ORDER = """
    ORDER BY
        CASE WHEN s.roll_number ~ '^[0-9]+$'
             THEN LPAD(s.roll_number, 10, '0')
             ELSE s.roll_number END
"""


async def _assert_refs(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    academic_year_id: uuid.UUID,
    class_id: uuid.UUID,
    section_id: uuid.UUID,
) -> None:
    if not await conn.fetchval(
        "SELECT 1 FROM academic_years WHERE id = $1 AND tenant_id = $2",
        academic_year_id, tenant_id,
    ):
        raise StudentError("Academic year not found for this tenant")
    if not await conn.fetchval(
        "SELECT 1 FROM classes WHERE id = $1 AND tenant_id = $2", class_id, tenant_id
    ):
        raise StudentError("Class not found for this tenant")
    if not await conn.fetchval(
        "SELECT 1 FROM sections WHERE id = $1 AND tenant_id = $2 AND class_id = $3",
        section_id, tenant_id, class_id,
    ):
        raise StudentError("Section not found for this class")


async def create_student(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, data: StudentCreate
) -> StudentResponse:
    await _assert_refs(conn, tenant_id, data.academic_year_id, data.class_id, data.section_id)
    try:
        row = await conn.fetchrow(
            """
            INSERT INTO students (
                tenant_id, academic_year_id, class_id, section_id,
                admission_no, roll_number, first_name, last_name,
                date_of_birth, gender, parent_phone, is_hosteler, is_transport
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
            RETURNING *
            """,
            tenant_id,
            data.academic_year_id, data.class_id, data.section_id,
            data.admission_no, data.roll_number,
            data.first_name, data.last_name,
            data.date_of_birth, data.gender, data.parent_phone,
            data.is_hosteler, data.is_transport,
        )
    except asyncpg.UniqueViolationError as e:
        msg = str(e)
        if "unique_tenant_admission_no" in msg:
            raise StudentError("Admission number already exists in this institution")
        if "unique_tenant_section_roll" in msg:
            raise StudentError("Roll number already taken in this section for this year")
        raise StudentError("Duplicate entry")

    await emit(conn, "STUDENT_CREATED", tenant_id, {
        "student_id": str(row["id"]),
        "admission_no": data.admission_no,
    })
    await generate_ledger_for_new_student(
        conn, tenant_id, row["id"], data.academic_year_id,
        data.class_id, bool(data.is_transport), bool(data.is_hosteler),
    )
    return StudentResponse(**dict(row))


async def list_students(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    academic_year_id: Optional[uuid.UUID] = None,
    class_id: Optional[uuid.UUID] = None,
    section_id: Optional[uuid.UUID] = None,
    limit: int = 100,
    offset: int = 0,
) -> StudentListResponse:
    where = """
        WHERE s.tenant_id = $1
          AND ($2::uuid IS NULL OR s.academic_year_id = $2::uuid)
          AND ($3::uuid IS NULL OR s.class_id         = $3::uuid)
          AND ($4::uuid IS NULL OR s.section_id       = $4::uuid)
          AND s.is_active = TRUE
    """
    args = (tenant_id, academic_year_id, class_id, section_id)

    total: int = await conn.fetchval(
        f"SELECT COUNT(*) FROM students s {where}", *args
    )
    rows = await conn.fetch(
        f"{_STUDENT_JOIN} {where} {_ROLL_ORDER} LIMIT $5 OFFSET $6",
        *args, limit, offset,
    )
    return StudentListResponse(
        items=[StudentResponse(**dict(r)) for r in rows],
        total=total,
    )


async def get_student(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, student_id: uuid.UUID
) -> Optional[StudentResponse]:
    row = await conn.fetchrow(
        f"{_STUDENT_JOIN} WHERE s.id = $1 AND s.tenant_id = $2",
        student_id, tenant_id,
    )
    return StudentResponse(**dict(row)) if row else None


async def update_student(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    student_id: uuid.UUID,
    data: StudentUpdate,
) -> Optional[StudentResponse]:
    fields = data.model_dump(exclude_none=True)
    if not fields:
        return await get_student(conn, tenant_id, student_id)

    set_clause = ", ".join(f"{k} = ${i + 3}" for i, k in enumerate(fields))
    try:
        row = await conn.fetchrow(
            f"UPDATE students SET {set_clause} WHERE id = $1 AND tenant_id = $2 RETURNING *",
            student_id, tenant_id, *fields.values(),
        )
    except asyncpg.UniqueViolationError as e:
        msg = str(e)
        if "unique_tenant_section_roll" in msg:
            raise StudentError("Roll number already taken in this section for this year")
        raise StudentError("Duplicate entry")

    if not row:
        return None

    await emit(conn, "STUDENT_UPDATED", tenant_id, {
        "student_id": str(student_id),
        "fields": list(fields.keys()),
    })
    return await get_student(conn, tenant_id, student_id)


async def set_parent_phone(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, student_id: uuid.UUID, parent_phone: str
) -> bool:
    """Update just the registered parent phone. Exposed to class teachers
    (scope-checked at the API layer) so they can collect real numbers for the
    parent-portal password rollout without full student-edit rights."""
    result = await conn.execute(
        "UPDATE students SET parent_phone = $1 WHERE id = $2 AND tenant_id = $3 AND is_active = TRUE",
        parent_phone, student_id, tenant_id,
    )
    if result != "UPDATE 1":
        return False
    await emit(conn, "STUDENT_UPDATED", tenant_id, {
        "student_id": str(student_id),
        "fields": ["parent_phone"],
    })
    return True


async def reset_portal_password(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    student_id: uuid.UUID,
    new_password: str,
    by_role: str,
) -> bool:
    """Staff override of a student's parent-portal password (no current-password
    check — that's the point of a staff reset). Class-teacher scope is enforced
    at the API layer."""
    from services.parent import MIN_PORTAL_PASSWORD_LEN

    new_password = (new_password or "").strip()
    if len(new_password) < MIN_PORTAL_PASSWORD_LEN:
        raise StudentError(
            f"Password must be at least {MIN_PORTAL_PASSWORD_LEN} characters"
        )
    from core.security import hash_password

    result = await conn.execute(
        "UPDATE students SET portal_password_hash = $1 WHERE id = $2 AND tenant_id = $3 AND is_active = TRUE",
        hash_password(new_password), student_id, tenant_id,
    )
    if result != "UPDATE 1":
        return False
    await emit(conn, "PARENT_PASSWORD_CHANGED", tenant_id, {
        "student_id": str(student_id),
        "by": "staff",
        "role": by_role,
    })
    return True


async def deactivate_student(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, student_id: uuid.UUID
) -> bool:
    result = await conn.execute(
        "UPDATE students SET is_active = FALSE WHERE id = $1 AND tenant_id = $2 AND is_active = TRUE",
        student_id, tenant_id,
    )
    return result == "UPDATE 1"


# ── Bulk Import ───────────────────────────────────────────────────────────────

async def import_students(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    academic_year_id: uuid.UUID,
    file_bytes: bytes,
) -> dict:
    try:
        import openpyxl
    except ImportError:
        raise StudentError("openpyxl not installed on server")

    wb = openpyxl.load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if len(rows) < 2:
        raise StudentError("File must have a header row and at least one data row")

    header = [str(h).strip().lower() if h is not None else "" for h in rows[0]]
    required = {"admission no", "first name", "last name", "class", "section",
                "roll no", "date of birth", "gender", "parent phone"}
    missing = required - set(header)
    if missing:
        raise StudentError(f"Missing columns: {missing}")

    idx = {name: header.index(name) for name in required}
    hosteler_col  = header.index("hosteler")  if "hosteler"  in header else None
    transport_col = header.index("transport") if "transport" in header else None

    class_rows = await conn.fetch(
        "SELECT id, name FROM classes WHERE tenant_id = $1", tenant_id
    )
    class_map = {r["name"].strip().lower(): r["id"] for r in class_rows}

    sec_rows = await conn.fetch(
        """SELECT s.id, s.name, c.name AS cn
           FROM sections s JOIN classes c ON c.id = s.class_id
           WHERE s.tenant_id = $1""",
        tenant_id,
    )
    section_map = {(r["cn"].strip().lower(), r["name"].strip().lower()): r["id"] for r in sec_rows}

    created = updated = 0
    errors: list[str] = []

    for row_num, row in enumerate(rows[1:], start=2):
        if all(cell is None for cell in row):
            continue
        try:
            admission_no = str(row[idx["admission no"]]).strip()
            first_name   = str(row[idx["first name"]]).strip()
            last_name    = str(row[idx["last name"]]).strip()
            class_str    = str(row[idx["class"]]).strip()
            section_str  = str(row[idx["section"]]).strip()
            roll_no      = str(row[idx["roll no"]]).strip()
            gender_in    = str(row[idx["gender"]]).strip()
            parent_phone = str(row[idx["parent phone"]]).strip()
            is_hosteler  = False
            if hosteler_col is not None:
                v = row[hosteler_col]
                is_hosteler = str(v).strip().lower() in ("yes", "true", "1") if v else False

            is_transport = False
            if transport_col is not None:
                v = row[transport_col]
                is_transport = str(v).strip().lower() in ("yes", "true", "1") if v else False

            dob_raw = row[idx["date of birth"]]
            if isinstance(dob_raw, datetime):
                dob = dob_raw.date()
            elif isinstance(dob_raw, date):
                dob = dob_raw
            else:
                dob = datetime.strptime(str(dob_raw).strip(), "%Y-%m-%d").date()

            # Accept M/F or full words; store canonical Male/Female/Other so the
            # Excel-import and the JSON-create (StudentCreate) paths agree on one
            # representation (the live audit asserts Male/Female/Other).
            gender = {"M": "Male", "F": "Female", "MALE": "Male", "FEMALE": "Female",
                      "O": "Other", "OTHER": "Other"}.get(gender_in.upper())
            if gender is None:
                raise ValueError(f"Gender must be M/F/Male/Female/Other, got '{gender_in}'")

            class_id = class_map.get(class_str.lower())
            if not class_id:
                raise ValueError(f"Class '{class_str}' not found")

            section_id = section_map.get((class_str.lower(), section_str.lower()))
            if not section_id:
                raise ValueError(f"Section '{section_str}' not found for class '{class_str}'")

            result = await conn.fetchrow(
                """
                INSERT INTO students
                    (tenant_id, academic_year_id, class_id, section_id,
                     admission_no, roll_number, first_name, last_name,
                     date_of_birth, gender, parent_phone, is_hosteler, is_transport)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
                ON CONFLICT (tenant_id, admission_no)
                DO UPDATE SET
                    academic_year_id = EXCLUDED.academic_year_id,
                    class_id         = EXCLUDED.class_id,
                    section_id       = EXCLUDED.section_id,
                    roll_number      = EXCLUDED.roll_number,
                    first_name       = EXCLUDED.first_name,
                    last_name        = EXCLUDED.last_name,
                    date_of_birth    = EXCLUDED.date_of_birth,
                    gender           = EXCLUDED.gender,
                    parent_phone     = EXCLUDED.parent_phone,
                    is_hosteler      = EXCLUDED.is_hosteler,
                    is_transport     = EXCLUDED.is_transport,
                    is_active        = TRUE
                RETURNING (xmax = 0) AS inserted
                """,
                tenant_id, academic_year_id, class_id, section_id,
                admission_no, roll_no, first_name, last_name,
                dob, gender, parent_phone, is_hosteler, is_transport,
            )
            if result["inserted"]:
                created += 1
            else:
                updated += 1

        except asyncpg.UniqueViolationError:
            errors.append(f"Row {row_num}: roll number already taken in this section")
        except Exception as exc:
            errors.append(f"Row {row_num}: {exc}")

    if created + updated > 0:
        await generate_year_ledger(conn, tenant_id, academic_year_id)
    return {"created": created, "updated": updated, "errors": errors}
