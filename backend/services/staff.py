import io
import uuid
from datetime import date, datetime
from typing import Optional

import asyncpg
import bcrypt

from core.events import emit
from core.security import hash_password
from models.staff import (
    AssignmentCreate,
    AssignmentResponse,
    StaffAccessResult,
    StaffCreate,
    StaffResponse,
    StaffUpdate,
)

VALID_ROLES = {"principal", "vice_principal", "class_teacher", "teacher", "accountant"}


class StaffError(Exception):
    pass


async def create_staff(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, data: StaffCreate,
    created_by: Optional[uuid.UUID] = None,
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
        "created_by": str(created_by) if created_by else None,
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
        WHERE s.tenant_id = $1
          AND ($2::text IS NULL OR s.designation = $2)
          AND ($3::boolean IS NULL OR s.is_active = $3)
    """
    args = (tenant_id, designation, is_active)

    total: int = await conn.fetchval(f"SELECT COUNT(*) FROM staff s {where}", *args)
    rows = await conn.fetch(
        f"""
        SELECT s.*, COALESCE(ur.roles, ARRAY[]::varchar[]) AS roles
        FROM staff s
        LEFT JOIN LATERAL (
            SELECT array_agg(role ORDER BY role) AS roles
            FROM user_roles
            WHERE user_id = s.user_id AND tenant_id = s.tenant_id
        ) ur ON true
        {where}
        ORDER BY s.first_name, s.last_name LIMIT $4 OFFSET $5
        """,
        *args, limit, offset,
    )
    return [StaffResponse(**dict(r)) for r in rows], total


async def get_staff_member(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, staff_id: uuid.UUID
) -> Optional[StaffResponse]:
    row = await conn.fetchrow(
        """
        SELECT s.*, COALESCE(ur.roles, ARRAY[]::varchar[]) AS roles
        FROM staff s
        LEFT JOIN LATERAL (
            SELECT array_agg(role ORDER BY role) AS roles
            FROM user_roles
            WHERE user_id = s.user_id AND tenant_id = s.tenant_id
        ) ur ON true
        WHERE s.id = $1 AND s.tenant_id = $2
        """,
        staff_id, tenant_id,
    )
    return StaffResponse(**dict(row)) if row else None


async def update_staff(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    staff_id: uuid.UUID,
    data: StaffUpdate,
    updated_by: Optional[uuid.UUID] = None,
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
        "updated_by": str(updated_by) if updated_by else None,
    })
    return StaffResponse(**dict(row))


async def deactivate_staff(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, staff_id: uuid.UUID,
    deactivated_by: Optional[uuid.UUID] = None,
) -> bool:
    result = await conn.execute(
        "UPDATE staff SET is_active = FALSE WHERE id = $1 AND tenant_id = $2 AND is_active = TRUE",
        staff_id, tenant_id,
    )
    if result != "UPDATE 1":
        return False
    await emit(conn, "STAFF_DEACTIVATED", tenant_id, {
        "staff_id": str(staff_id),
        "deactivated_by": str(deactivated_by) if deactivated_by else None,
    })
    return True


async def _replace_user_roles(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, user_id: uuid.UUID, roles: list[str]
) -> None:
    """Full-replace a user's held role set (delete then bulk-insert), used by
    both set_staff_roles and import_staff so the two don't re-implement this
    separately."""
    await conn.execute(
        "DELETE FROM user_roles WHERE tenant_id = $1 AND user_id = $2",
        tenant_id, user_id,
    )
    await conn.executemany(
        "INSERT INTO user_roles (tenant_id, user_id, role) VALUES ($1, $2, $3)",
        [(tenant_id, user_id, role) for role in roles],
    )


async def set_staff_roles(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, staff_id: uuid.UUID, roles: list[str],
    assigned_by: Optional[uuid.UUID] = None,
) -> Optional[StaffAccessResult]:
    """Assign/replace a staff member's held role set (a staff member may hold
    more than one role at once, e.g. accountant + teacher). Grants a login on
    first assignment (username = phone number, password = first 4 digits of
    phone + "@" + first name — same convention already used for bulk
    imports), otherwise replaces the roles on their existing login. Returns
    None if the staff member doesn't exist (404 at the API layer); raises
    StaffError for validation problems (invalid role, phone already claimed
    by someone else's login)."""
    invalid = [r for r in roles if r not in VALID_ROLES]
    if invalid:
        raise StaffError(
            f"Invalid role(s) {invalid}. Valid: {', '.join(sorted(VALID_ROLES))}"
        )
    if not roles:
        raise StaffError("At least one role is required")

    staff = await conn.fetchrow(
        "SELECT id, user_id, phone_number, first_name FROM staff WHERE id = $1 AND tenant_id = $2",
        staff_id, tenant_id,
    )
    if not staff:
        return None

    login_created = False
    generated_password: Optional[str] = None
    # users.role stays NOT NULL and is a frozen legacy snapshot (roles[0]) —
    # no new code reads it; the real source of truth is user_roles.
    primary_role = roles[0]

    if staff["user_id"] is not None:
        await conn.execute(
            "UPDATE users SET role = $1 WHERE id = $2 AND tenant_id = $3",
            primary_role, staff["user_id"], tenant_id,
        )
        user_id = staff["user_id"]
    else:
        other = await conn.fetchrow(
            """SELECT s.first_name, s.last_name FROM users u
               JOIN staff s ON s.user_id = u.id AND s.tenant_id = u.tenant_id
               WHERE u.tenant_id = $1 AND u.phone_number = $2""",
            tenant_id, staff["phone_number"],
        )
        if other:
            raise StaffError(
                f"Phone {staff['phone_number']} is already used for "
                f"{other['first_name']} {other['last_name']}'s login — "
                "can't create a second login with the same number."
            )

        generated_password = f"{staff['phone_number'][:4]}@{staff['first_name']}"
        pw_hash = bcrypt.hashpw(generated_password.encode(), bcrypt.gensalt()).decode()
        user_row = await conn.fetchrow(
            """
            INSERT INTO users (tenant_id, phone_number, password_hash, role)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (tenant_id, phone_number) DO UPDATE SET role = EXCLUDED.role
            RETURNING id
            """,
            tenant_id, staff["phone_number"], pw_hash, primary_role,
        )
        user_id = user_row["id"]
        await conn.execute(
            "UPDATE staff SET user_id = $1 WHERE id = $2 AND tenant_id = $3",
            user_id, staff_id, tenant_id,
        )
        login_created = True

    # Full replace applies uniformly to both branches above — this also
    # closes a latent edge case where an orphaned users row (no staff row
    # pointing at it, so the collision check above wouldn't have caught it)
    # could otherwise retain a stale role set from whatever it used to be.
    await _replace_user_roles(conn, tenant_id, user_id, roles)

    await emit(conn, "STAFF_ROLE_ASSIGNED", tenant_id, {
        "staff_id": str(staff_id), "roles": roles, "login_created": login_created,
        "assigned_by": str(assigned_by) if assigned_by else None,
    })

    member = await get_staff_member(conn, tenant_id, staff_id)
    return StaffAccessResult(staff=member, login_created=login_created, generated_password=generated_password)


class StaffPasswordResetOutcome:
    NOT_FOUND = "not_found"
    NO_LOGIN = "no_login"
    OK = "ok"


async def reset_staff_password(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, staff_id: uuid.UUID, new_password: str,
    reset_by: Optional[uuid.UUID] = None,
) -> str:
    """Principal-console override: set a staff member's password directly, no
    current-password check (that's the point of an admin override). Returns
    one of StaffPasswordResetOutcome's values instead of raising, so the API
    layer can map each case to the right HTTP status."""
    staff = await conn.fetchrow(
        "SELECT user_id FROM staff WHERE id = $1 AND tenant_id = $2", staff_id, tenant_id
    )
    if not staff:
        return StaffPasswordResetOutcome.NOT_FOUND
    if not staff["user_id"]:
        return StaffPasswordResetOutcome.NO_LOGIN

    await conn.execute(
        "UPDATE users SET password_hash = $1 WHERE id = $2 AND tenant_id = $3",
        hash_password(new_password), staff["user_id"], tenant_id,
    )
    await emit(conn, "PASSWORD_CHANGED", tenant_id, {
        "staff_id": str(staff_id), "by": "principal",
        "reset_by": str(reset_by) if reset_by else None,
    })
    return StaffPasswordResetOutcome.OK


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
    assigned_by: Optional[uuid.UUID] = None,
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
    except asyncpg.UniqueViolationError:
        raise StaffError("This assignment already exists")

    full = await conn.fetchrow(
        f"{_ASSIGNMENT_JOIN} WHERE a.id = $1", row["id"]
    )
    await emit(conn, "STAFF_ASSIGNED", tenant_id, {
        "staff_id": str(staff_id),
        "class_id": str(data.class_id),
        "section_id": str(data.section_id),
        "assigned_by": str(assigned_by) if assigned_by else None,
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


async def list_all_assignments(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, academic_year_id: Optional[uuid.UUID] = None
) -> list[dict]:
    """Return all assignments for the tenant with staff name info — for the principal panel."""
    rows = await conn.fetch(
        """
        SELECT
            a.*,
            c.name    AS class_name,
            s.name    AS section_name,
            ay.name   AS academic_year_name,
            st.first_name  AS staff_first_name,
            st.last_name   AS staff_last_name,
            st.designation AS staff_designation
        FROM staff_class_assignments a
        JOIN classes        c  ON c.id  = a.class_id
        JOIN sections       s  ON s.id  = a.section_id
        JOIN academic_years ay ON ay.id = a.academic_year_id
        JOIN staff st ON st.id = a.staff_id
        WHERE a.tenant_id = $1
          AND ($2::uuid IS NULL OR a.academic_year_id = $2::uuid)
        ORDER BY c.name, s.name, ay.name, st.first_name, st.last_name
        """,
        tenant_id, academic_year_id,
    )
    result = []
    for r in rows:
        d = dict(r)
        result.append({
            "id": str(d["id"]),
            "staff_id": str(d["staff_id"]),
            "academic_year_id": str(d["academic_year_id"]),
            "class_id": str(d["class_id"]),
            "section_id": str(d["section_id"]),
            "subject": d["subject"],
            "is_class_teacher": d["is_class_teacher"],
            "class_name": d["class_name"],
            "section_name": d["section_name"],
            "academic_year_name": d["academic_year_name"],
            "staff_name": d["staff_first_name"] + " " + d["staff_last_name"],
            "designation": d.get("staff_designation"),
        })
    return result


async def delete_assignment(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, staff_id: uuid.UUID, assignment_id: uuid.UUID,
    removed_by: Optional[uuid.UUID] = None,
) -> bool:
    result = await conn.execute(
        "DELETE FROM staff_class_assignments WHERE id = $1 AND staff_id = $2 AND tenant_id = $3",
        assignment_id, staff_id, tenant_id,
    )
    if result != "DELETE 1":
        return False
    await emit(conn, "STAFF_ASSIGNMENT_REMOVED", tenant_id, {
        "staff_id": str(staff_id),
        "assignment_id": str(assignment_id),
        "removed_by": str(removed_by) if removed_by else None,
    })
    return True


async def export_all_staff(
    conn: asyncpg.Connection, tenant_id: uuid.UUID
) -> list[StaffResponse]:
    rows = await conn.fetch(
        "SELECT * FROM staff WHERE tenant_id = $1 ORDER BY employee_no",
        tenant_id,
    )
    return [StaffResponse(**dict(r)) for r in rows]


# ── Bulk Import ───────────────────────────────────────────────────────────────

async def import_staff(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    file_bytes: bytes,
    imported_by: Optional[uuid.UUID] = None,
) -> dict:
    try:
        import openpyxl
    except ImportError:
        raise StaffError("openpyxl not installed on server")

    wb = openpyxl.load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if len(rows) < 2:
        raise StaffError("File must have a header row and at least one data row")

    header = [str(h).strip().lower() if h is not None else "" for h in rows[0]]
    required = {"employee no", "first name", "last name", "phone", "designation", "date of joining"}
    missing = required - set(header)
    if missing:
        raise StaffError(f"Missing columns: {missing}")

    idx = {name: header.index(name) for name in required}
    opt_idx = {col: header.index(col) for col in
               ("department", "date of birth", "role", "login phone") if col in header}

    created = updated = users_created = 0
    errors: list[str] = []

    for row_num, row in enumerate(rows[1:], start=2):
        if all(cell is None for cell in row):
            continue
        try:
            emp_no      = str(row[idx["employee no"]]).strip()
            first_name  = str(row[idx["first name"]]).strip()
            last_name   = str(row[idx["last name"]]).strip()
            phone       = str(row[idx["phone"]]).strip()
            designation = str(row[idx["designation"]]).strip()

            doj_raw = row[idx["date of joining"]]
            if isinstance(doj_raw, datetime):
                doj = doj_raw.date()
            elif isinstance(doj_raw, date):
                doj = doj_raw
            else:
                doj = datetime.strptime(str(doj_raw).strip(), "%Y-%m-%d").date()

            department = dob = role = login_phone = None

            if "department" in opt_idx:
                v = row[opt_idx["department"]]
                if v: department = str(v).strip()

            if "date of birth" in opt_idx:
                v = row[opt_idx["date of birth"]]
                if v:
                    if isinstance(v, datetime): dob = v.date()
                    elif isinstance(v, date): dob = v
                    else: dob = datetime.strptime(str(v).strip(), "%Y-%m-%d").date()

            if "role" in opt_idx:
                v = row[opt_idx["role"]]
                if v: role = str(v).strip().lower()

            if "login phone" in opt_idx:
                v = row[opt_idx["login phone"]]
                if v: login_phone = str(v).strip()

            if role and role not in VALID_ROLES:
                raise ValueError(f"Invalid role '{role}'. Valid: {', '.join(sorted(VALID_ROLES))}")

            user_id = None
            if role and login_phone:
                import bcrypt
                pw_hash = bcrypt.hashpw(login_phone.encode(), bcrypt.gensalt()).decode()
                user_row = await conn.fetchrow(
                    """
                    INSERT INTO users (tenant_id, phone_number, password_hash, role)
                    VALUES ($1,$2,$3,$4)
                    ON CONFLICT (tenant_id, phone_number)
                    DO UPDATE SET role = EXCLUDED.role
                    RETURNING id, (xmax = 0) AS inserted
                    """,
                    tenant_id, login_phone, pw_hash, role,
                )
                user_id = user_row["id"]
                if user_row["inserted"]:
                    users_created += 1
                await _replace_user_roles(conn, tenant_id, user_id, [role])

            result = await conn.fetchrow(
                """
                INSERT INTO staff
                    (tenant_id, user_id, employee_no, first_name, last_name,
                     phone_number, designation, department, date_of_joining, date_of_birth)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                ON CONFLICT (tenant_id, employee_no)
                DO UPDATE SET
                    user_id        = COALESCE(EXCLUDED.user_id, staff.user_id),
                    first_name     = EXCLUDED.first_name,
                    last_name      = EXCLUDED.last_name,
                    phone_number   = EXCLUDED.phone_number,
                    designation    = EXCLUDED.designation,
                    department     = EXCLUDED.department,
                    date_of_joining = EXCLUDED.date_of_joining,
                    date_of_birth  = EXCLUDED.date_of_birth,
                    is_active      = TRUE
                RETURNING (xmax = 0) AS inserted
                """,
                tenant_id, user_id, emp_no, first_name, last_name,
                phone, designation, department, doj, dob,
            )
            if result["inserted"]:
                created += 1
            else:
                updated += 1

        except Exception as exc:
            errors.append(f"Row {row_num}: {exc}")

    await emit(conn, "STAFF_IMPORTED", tenant_id, {
        "created": created, "updated": updated, "users_created": users_created,
        "error_count": len(errors), "imported_by": str(imported_by) if imported_by else None,
    })
    return {"created": created, "updated": updated, "users_created": users_created, "errors": errors}
