#!/usr/bin/env python3
"""
Seed one teacher login + one accountant login per school, with class assignment.

Idempotent — safe to re-run. Uses ON CONFLICT DO NOTHING / DO UPDATE.

What this creates per school:
  - teacher  user  (phone 9900000001, role='class_teacher')
  - accountant user (phone 9900000002, role='accountant')
  - staff record for each, linked via user_id
  - one staff_class_assignments row: Grade 9 / Section A, Mathematics,
    is_class_teacher=TRUE  (so teacher can log in and see their classes)

Accountants are fee-module only — no class assignment needed.

Usage:
    cd backend
    DATABASE_URL=postgresql://tulips:tulips@localhost:5432/tulipsedu \
        python ../scripts/seed_mock_logins.py
"""

import asyncio
import os

import asyncpg
import bcrypt

# ── Credentials (same phone works across tenants — unique per tenant_id) ──────

TEACHER_PHONE    = "9900000001"
TEACHER_PASSWORD = "Teacher@2024"
TEACHER_EMP_NO   = "EMP-TCH01"

ACCOUNTANT_PHONE    = "9900000002"
ACCOUNTANT_PASSWORD = "Accounts@2024"
ACCOUNTANT_EMP_NO   = "EMP-ACT01"

SCHOOLS = [
    {
        "slug": "daffodilspublicschool",
        "name": "Daffodils Public School",
        "teacher_name":    ("Meena", "Sharma"),
        "accountant_name": ("Rakesh", "Gupta"),
    },
    {
        "slug": "premchandhighschool",
        "name": "Premchand High School",
        "teacher_name":    ("Sunita", "Verma"),
        "accountant_name": ("Anil", "Kumar"),
    },
    {
        "slug": "premchandmahtoic",
        "name": "Premchand Mahto IC",
        "teacher_name":    ("Preethi", "Mishra"),
        "accountant_name": ("Suresh", "Pandey"),
    },
    {
        "slug": "vivekmemorialhighschool",
        "name": "Vivek Memorial High School",
        "teacher_name":    ("Vandana", "Singh"),
        "accountant_name": ("Harish", "Das"),
    },
]


def pw_hash(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


async def seed_logins(conn: asyncpg.Connection, school: dict) -> dict | None:
    slug = school["slug"]

    # Resolve tenant
    tid = await conn.fetchval("SELECT id FROM tenants WHERE slug = $1", slug)
    if not tid:
        print(f"  [SKIP] tenant '{slug}' not found — run seed_schools.py first")
        return None

    # Resolve current academic year
    ay_id = await conn.fetchval(
        "SELECT id FROM academic_years WHERE tenant_id = $1 AND is_current = TRUE", tid
    )
    if not ay_id:
        print(f"  [SKIP] no current academic year for '{slug}'")
        return None

    # Resolve Grade 9 / Section A
    cls_id = await conn.fetchval(
        "SELECT id FROM classes WHERE tenant_id = $1 AND name = 'Grade 9'", tid
    )
    sec_id = await conn.fetchval(
        "SELECT id FROM sections WHERE tenant_id = $1 AND class_id = $2 AND name = 'A'",
        tid, cls_id,
    ) if cls_id else None

    # ── Teacher ───────────────────────────────────────────────────────────────
    t_first, t_last = school["teacher_name"]
    t_user_id = await conn.fetchval(
        """
        INSERT INTO users (tenant_id, phone_number, password_hash, role)
        VALUES ($1, $2, $3, 'class_teacher')
        ON CONFLICT (tenant_id, phone_number)
        DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role
        RETURNING id
        """,
        tid, TEACHER_PHONE, pw_hash(TEACHER_PASSWORD),
    )

    t_staff_id = await conn.fetchval(
        """
        INSERT INTO staff
            (tenant_id, user_id, employee_no, first_name, last_name,
             phone_number, designation, date_of_joining)
        VALUES ($1, $2, $3, $4, $5, $6, 'Class Teacher', '2022-04-01')
        ON CONFLICT (tenant_id, employee_no)
        DO UPDATE SET user_id = EXCLUDED.user_id,
                      first_name = EXCLUDED.first_name,
                      last_name  = EXCLUDED.last_name,
                      phone_number = EXCLUDED.phone_number
        RETURNING id
        """,
        tid, t_user_id, TEACHER_EMP_NO, t_first, t_last, TEACHER_PHONE,
    )

    # Class assignment: Grade 9-A, Mathematics, is_class_teacher=TRUE
    assigned = False
    if cls_id and sec_id and t_staff_id:
        try:
            await conn.execute(
                """
                INSERT INTO staff_class_assignments
                    (tenant_id, staff_id, academic_year_id, class_id, section_id,
                     subject, is_class_teacher)
                VALUES ($1, $2, $3, $4, $5, 'Mathematics', TRUE)
                ON CONFLICT DO NOTHING
                """,
                tid, t_staff_id, ay_id, cls_id, sec_id,
            )
            assigned = True
        except Exception as e:
            # Partial index conflict means another class teacher already assigned
            print(f"  [WARN] class teacher assignment conflict for {slug}: {e}")

    # ── Accountant ────────────────────────────────────────────────────────────
    a_first, a_last = school["accountant_name"]
    a_user_id = await conn.fetchval(
        """
        INSERT INTO users (tenant_id, phone_number, password_hash, role)
        VALUES ($1, $2, $3, 'accountant')
        ON CONFLICT (tenant_id, phone_number)
        DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role
        RETURNING id
        """,
        tid, ACCOUNTANT_PHONE, pw_hash(ACCOUNTANT_PASSWORD),
    )

    await conn.execute(
        """
        INSERT INTO staff
            (tenant_id, user_id, employee_no, first_name, last_name,
             phone_number, designation, date_of_joining)
        VALUES ($1, $2, $3, $4, $5, $6, 'Accountant', '2022-04-01')
        ON CONFLICT (tenant_id, employee_no)
        DO UPDATE SET user_id = EXCLUDED.user_id,
                      first_name = EXCLUDED.first_name,
                      last_name  = EXCLUDED.last_name,
                      phone_number = EXCLUDED.phone_number
        """,
        tid, a_user_id, ACCOUNTANT_EMP_NO, a_first, a_last, ACCOUNTANT_PHONE,
    )

    return {
        "slug": slug,
        "name": school["name"],
        "assigned": assigned,
        "class": "Grade 9 / Section A" if (cls_id and sec_id) else "no Grade 9 found",
    }


async def main() -> None:
    dsn = os.environ.get(
        "DATABASE_URL", "postgresql://tulips:tulips@localhost:5432/tulipsedu"
    )
    conn = await asyncpg.connect(dsn)

    print("\n=== Seeding mock teacher + accountant logins ===\n")
    results = []
    for school in SCHOOLS:
        print(f"  {school['name']} ({school['slug']})")
        async with conn.transaction():
            r = await seed_logins(conn, school)
        if r:
            results.append(r)

    await conn.close()

    if not results:
        print("\nNothing seeded — check that seed_schools.py was run first.\n")
        return

    # ── Credentials summary ──────────────────────────────────────────────────
    print("\n" + "=" * 70)
    print("CREDENTIALS — share with testers")
    print("=" * 70)
    print(f"\n  Teacher login  (role: class_teacher)")
    print(f"  Phone    : {TEACHER_PHONE}")
    print(f"  Password : {TEACHER_PASSWORD}")
    print(f"  Scope    : Grade 9 / Section A (attendance, homework, exams)\n")
    print(f"  Accountant login  (role: accountant)")
    print(f"  Phone    : {ACCOUNTANT_PHONE}")
    print(f"  Password : {ACCOUNTANT_PASSWORD}")
    print(f"  Scope    : Fees module only (collect, verify, receipts)\n")
    print("  These credentials work on ALL four schools.")
    print("  Login URL pattern: https://<slug>.tulipsedu.in\n")
    print("  Schools:")
    for r in results:
        assigned_note = f"assigned to {r['class']}" if r["assigned"] else f"WARNING: not assigned ({r['class']})"
        print(f"    {r['slug']:<30}  teacher {assigned_note}")
    print()


if __name__ == "__main__":
    asyncio.run(main())
