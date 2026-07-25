"""
Onboard Sagar Lohra into PMIC -- named in the original teacher-subject PDF
(CMS/CHE = Computer Science + Chemistry, Science stream) but never
imported into staff at all, flagged as a known gap in
assign_pmic_teachers.py. Owner supplied his real phone directly:
9905706281.

Three steps, same conventions as every other PMIC/DPS staff script:
  1. staff row (employee_no next in sequence, designation "Lecturer" to
     match the other lecturers, date_of_joining = today as placeholder
     per established convention).
  2. Login: users row (role=teacher) + user_roles, password = standard
     convention (phone[:4] + "@" + FirstName, Title Case) -- same as
     create_staff_login.py, inlined here since that script requires the
     staff row to already exist.
  3. staff_class_assignments: Computer Science + Chemistry for Class
     11/12 Science (his real subjects), plus blanket subject=NULL rows
     for Class 11/12 Arts and Commerce -- exact same pattern
     assign_pmic_teachers.py used for the other 11 teachers, so he has
     the same all-classes attendance/homework access as everyone else.

Phone 9905706281 happens to already belong to a different "Sagar" at
daffodilspublicschool (a different tenant) -- no collision, phone
uniqueness is tenant-scoped, but flagging in case it's the same person
moonlighting at two schools rather than a coincidence.
"""

import asyncio
import os
import sys
import uuid
from datetime import date

import asyncpg
import bcrypt

sys.path.insert(0, __import__("pathlib").Path(__file__).parent.parent.as_posix())
from models.staff import AssignmentCreate, StaffCreate
from services.staff import create_assignment, create_staff

TENANT_SLUG = "premchandmahtoic"
FIRST_NAME = "Sagar"
LAST_NAME = "Lohra"
PHONE = "9905706281"
DESIGNATION = "Lecturer"
ROLE = "teacher"
SUBJECTS = ["Computer Science", "Chemistry"]
CLASS_NAMES = ["Class 11", "Class 12"]
STREAMS = ["Arts", "Commerce", "Science"]
HOME_STREAM = "Science"


async def main():
    database_url = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(database_url)

    tenant = await conn.fetchrow("SELECT id FROM tenants WHERE slug = $1", TENANT_SLUG)
    if not tenant:
        print(f"ERROR: tenant '{TENANT_SLUG}' not found"); await conn.close(); return
    tenant_id: uuid.UUID = tenant["id"]

    existing = await conn.fetchrow(
        "SELECT id FROM staff WHERE tenant_id = $1 AND first_name = $2 AND last_name = $3",
        tenant_id, FIRST_NAME, LAST_NAME,
    )
    if existing:
        print(f"ERROR: {FIRST_NAME} {LAST_NAME} already exists in staff (id={existing['id']}) — refusing to duplicate"); await conn.close(); return

    max_emp = await conn.fetchval(
        "SELECT employee_no FROM staff WHERE tenant_id = $1 ORDER BY employee_no DESC LIMIT 1", tenant_id
    )
    next_num = int(max_emp.replace("EMP", "")) + 1 if max_emp else 1
    employee_no = f"EMP{next_num:03d}"

    ay = await conn.fetchrow(
        "SELECT id FROM academic_years WHERE tenant_id = $1 AND is_current = TRUE", tenant_id
    )
    academic_year_id: uuid.UUID = ay["id"]

    class_rows = await conn.fetch(
        "SELECT id, name FROM classes WHERE tenant_id = $1 AND name = ANY($2::text[])",
        tenant_id, CLASS_NAMES,
    )
    class_map = {r["name"]: r["id"] for r in class_rows}
    section_rows = await conn.fetch(
        """
        SELECT c.name AS class_name, s.name AS section_name, s.id AS section_id
        FROM sections s JOIN classes c ON c.id = s.class_id
        WHERE s.tenant_id = $1 AND c.name = ANY($2::text[])
        """,
        tenant_id, CLASS_NAMES,
    )
    section_map = {(r["class_name"], r["section_name"]): r["section_id"] for r in section_rows}

    async with conn.transaction():
        # 1. Login (users + user_roles)
        password = f"{PHONE[:4]}@{FIRST_NAME.title()}"
        pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
        user_row = await conn.fetchrow(
            """
            INSERT INTO users (tenant_id, phone_number, password_hash, role)
            VALUES ($1,$2,$3,$4)
            ON CONFLICT (tenant_id, phone_number)
            DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role
            RETURNING id
            """,
            tenant_id, PHONE, pw_hash, ROLE,
        )
        user_id = user_row["id"]
        await conn.execute(
            "INSERT INTO user_roles (tenant_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
            tenant_id, user_id, ROLE,
        )

        # 2. Staff row
        staff = await create_staff(conn, tenant_id, StaffCreate(
            employee_no=employee_no, first_name=FIRST_NAME, last_name=LAST_NAME,
            phone_number=PHONE, designation=DESIGNATION, department=None,
            date_of_joining=date.today(), date_of_birth=None, user_id=user_id,
        ))

        # 3. Class assignments — same pattern as assign_pmic_teachers.py
        created_assignments = 0
        for class_name in CLASS_NAMES:
            class_id = class_map[class_name]
            for stream in STREAMS:
                section_id = section_map[(class_name, stream)]
                if stream == HOME_STREAM:
                    for subject in SUBJECTS:
                        await create_assignment(conn, tenant_id, staff.id, AssignmentCreate(
                            academic_year_id=academic_year_id, class_id=class_id,
                            section_id=section_id, subject=subject, is_class_teacher=False,
                        ))
                        created_assignments += 1
                else:
                    await create_assignment(conn, tenant_id, staff.id, AssignmentCreate(
                        academic_year_id=academic_year_id, class_id=class_id,
                        section_id=section_id, subject=None, is_class_teacher=False,
                    ))
                    created_assignments += 1

    await conn.close()

    print(f"OK  {FIRST_NAME} {LAST_NAME} ({employee_no})  login={PHONE}  role={ROLE}  "
          f"password set to standard convention (phone[:4]@FirstName)  "
          f"assignments created={created_assignments}")


if __name__ == "__main__":
    asyncio.run(main())
