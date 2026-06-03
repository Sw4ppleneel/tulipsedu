import uuid
from typing import Optional

import asyncpg

from core.events import emit
from models.staff import (
    AssignmentCreate,
    AssignmentResponse,
    StaffCreate,
    StaffResponse,
    StaffUpdate,
)


class StaffError(Exception):
    pass


async def create_staff(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, data: StaffCreate
) -> StaffResponse:
    try:
        row = await conn.fetchrow(
            """
            INSERT INTO staff (
                tenant_id, user_id, employee_no, first_name, last_name,
                phone_number, designation, department, date_of_joining, date_of_birth
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            RETURNING *
            """,
            tenant_id, data.user_id, data.employee_no,
            data.first_name, data.last_name, data.phone_number,
            data.designation, data.department,
            data.date_of_joining, data.date_of_birth,
        )
    except asyncpg.UniqueViolationError:
        raise StaffError("Employee number already exists in this institution")

    await emit(conn, "STAFF_CREATED", tenant_id, {
        "staff_id": str(row["id"]),
        "employee_no": data.employee_no,
    })
    return StaffResponse(**dict(row))


async def list_staff(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    designation: Optional[str] = None,
    is_active: Optional[bool] = True,
    limit: int = 200,
    offset: int = 0,
) -> tuple[list[StaffResponse], int]:
    where = """
        WHERE tenant_id = $1
          AND ($2::text IS NULL OR designation = $2)
          AND ($3::boolean IS NULL OR is_active = $3)
    """
    args = (tenant_id, designation, is_active)

    total: int = await conn.fetchval(f"SELECT COUNT(*) FROM staff {where}", *args)
    rows = await conn.fetch(
        f"SELECT * FROM staff {where} ORDER BY first_name, last_name LIMIT $4 OFFSET $5",
        *args, limit, offset,
    )
    return [StaffResponse(**dict(r)) for r in rows], total


async def get_staff_member(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, staff_id: uuid.UUID
) -> Optional[StaffResponse]:
    row = await conn.fetchrow(
        "SELECT * FROM staff WHERE id = $1 AND tenant_id = $2", staff_id, tenant_id
    )
    return StaffResponse(**dict(row)) if row else None


async def update_staff(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    staff_id: uuid.UUID,
    data: StaffUpdate,
) -> Optional[StaffResponse]:
    fields = data.model_dump(exclude_none=True)
    if not fields:
        return await get_staff_member(conn, tenant_id, staff_id)

    set_clause = ", ".join(f"{k} = ${i + 3}" for i, k in enumerate(fields))
    row = await conn.fetchrow(
        f"UPDATE staff SET {set_clause} WHERE id = $1 AND tenant_id = $2 RETURNING *",
        staff_id, tenant_id, *fields.values(),
    )
    if not row:
        return None

    await emit(conn, "STAFF_UPDATED", tenant_id, {
        "staff_id": str(staff_id),
        "fields": list(fields.keys()),
    })
    return StaffResponse(**dict(row))


async def deactivate_staff(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, staff_id: uuid.UUID
) -> bool:
    result = await conn.execute(
        "UPDATE staff SET is_active = FALSE WHERE id = $1 AND tenant_id = $2 AND is_active = TRUE",
        staff_id, tenant_id,
    )
    return result == "UPDATE 1"


# ── Class Assignments ─────────────────────────────────────────────────────────

_ASSIGNMENT_JOIN = """
    SELECT
        a.*,
        c.name   AS class_name,
        s.name   AS section_name,
        ay.name  AS academic_year_name
    FROM staff_class_assignments a
    JOIN classes        c  ON c.id  = a.class_id
    JOIN sections       s  ON s.id  = a.section_id
    JOIN academic_years ay ON ay.id = a.academic_year_id
"""


async def create_assignment(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    staff_id: uuid.UUID,
    data: AssignmentCreate,
) -> AssignmentResponse:
    if not await conn.fetchval(
        "SELECT 1 FROM staff WHERE id = $1 AND tenant_id = $2", staff_id, tenant_id
    ):
        raise StaffError("Staff member not found")

    try:
        row = await conn.fetchrow(
            """
            INSERT INTO staff_class_assignments
                (tenant_id, staff_id, academic_year_id, class_id, section_id, subject, is_class_teacher)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            RETURNING *
            """,
            tenant_id, staff_id,
            data.academic_year_id, data.class_id, data.section_id,
            data.subject, data.is_class_teacher,
        )
    except asyncpg.UniqueViolationError as e:
        msg = str(e)
        if "sca_one_class_teacher_idx" in msg:
            raise StaffError("This section already has a class teacher assigned")
        raise StaffError("This assignment already exists")

    full = await conn.fetchrow(
        f"{_ASSIGNMENT_JOIN} WHERE a.id = $1", row["id"]
    )
    await emit(conn, "STAFF_ASSIGNED", tenant_id, {
        "staff_id": str(staff_id),
        "class_id": str(data.class_id),
        "section_id": str(data.section_id),
    })
    return AssignmentResponse(**dict(full))


async def list_assignments(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, staff_id: uuid.UUID
) -> list[AssignmentResponse]:
    rows = await conn.fetch(
        f"{_ASSIGNMENT_JOIN} WHERE a.staff_id = $1 AND a.tenant_id = $2 ORDER BY ay.name, c.name, s.name",
        staff_id, tenant_id,
    )
    return [AssignmentResponse(**dict(r)) for r in rows]


async def export_all_staff(
    conn: asyncpg.Connection, tenant_id: uuid.UUID
) -> list[StaffResponse]:
    rows = await conn.fetch(
        "SELECT * FROM staff WHERE tenant_id = $1 ORDER BY employee_no",
        tenant_id,
    )
    return [StaffResponse(**dict(r)) for r in rows]
