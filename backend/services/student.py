import uuid
from typing import Optional

import asyncpg

from core.events import emit
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
                date_of_birth, gender, parent_phone, is_hosteler
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            RETURNING *
            """,
            tenant_id,
            data.academic_year_id, data.class_id, data.section_id,
            data.admission_no, data.roll_number,
            data.first_name, data.last_name,
            data.date_of_birth, data.gender, data.parent_phone, data.is_hosteler,
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


async def deactivate_student(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, student_id: uuid.UUID
) -> bool:
    result = await conn.execute(
        "UPDATE students SET is_active = FALSE WHERE id = $1 AND tenant_id = $2 AND is_active = TRUE",
        student_id, tenant_id,
    )
    return result == "UPDATE 1"
