"""
Fill in real phone numbers for two DPS support staff who had no number in
either source when reset_and_import_dps_teachers.py ran (placeholder
phone_number="0000000000", no login): Indu Kumari (EMP021, Accountant) and
Mamta Kumari (EMP020, Office Incharge). Owner supplied both numbers
directly, 2026-07-16.

Indu Kumari's role (Accountant) is in VALID_ROLES, so now that she has a
real phone she also gets a login (same convention as everyone else:
username=phone, password=first 4 digits+@+first name). Mamta Kumari's role
(Office Incharge) has no VALID_ROLES match — phone updated, no login,
consistent with the original import's role-mapping logic.
"""

import asyncio
import os
import sys
from pathlib import Path

import asyncpg
import bcrypt

TENANT_SLUG = "daffodilspublicschool"

UPDATES = [
    # employee_no, first_name, last_name, phone, grant_login, role
    ("EMP021", "Indu", "Kumari", "9304091054", True, "accountant"),
    ("EMP020", "Mamta", "Kumari", "6203757534", False, None),
]


async def main():
    database_url = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(database_url)

    tenant = await conn.fetchrow("SELECT id FROM tenants WHERE slug = $1", TENANT_SLUG)
    if not tenant:
        print(f"ERROR: tenant '{TENANT_SLUG}' not found"); await conn.close(); return
    tenant_id = tenant["id"]

    async with conn.transaction():
        for emp_no, first, last, phone, grant_login, role in UPDATES:
            staff = await conn.fetchrow(
                "SELECT id, user_id, first_name, last_name FROM staff "
                "WHERE tenant_id = $1 AND employee_no = $2",
                tenant_id, emp_no,
            )
            if not staff:
                print(f"ERROR: {emp_no} not found"); continue
            if staff["first_name"] != first or staff["last_name"] != last:
                print(f"ERROR: {emp_no} name mismatch — expected {first} {last}, "
                      f"found {staff['first_name']} {staff['last_name']}")
                continue

            await conn.execute(
                "UPDATE staff SET phone_number = $1 WHERE id = $2 AND tenant_id = $3",
                phone, staff["id"], tenant_id,
            )

            login_str = "no login (unchanged)"
            if grant_login and not staff["user_id"]:
                pw = f"{phone[:4]}@{first}"
                pw_hash = bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()
                user_row = await conn.fetchrow(
                    """INSERT INTO users (tenant_id, phone_number, password_hash, role)
                       VALUES ($1,$2,$3,$4) RETURNING id""",
                    tenant_id, phone, pw_hash, role,
                )
                await conn.execute(
                    "UPDATE staff SET user_id = $1 WHERE id = $2 AND tenant_id = $3",
                    user_row["id"], staff["id"], tenant_id,
                )
                await conn.execute(
                    "INSERT INTO user_roles (tenant_id, user_id, role) VALUES ($1, $2, $3)",
                    tenant_id, user_row["id"], role,
                )
                login_str = f"login created (pw={pw})"

            print(f"  {emp_no}  {first} {last}: phone={phone}  {login_str}")

    await conn.close()
    print("\nDone.")


if __name__ == "__main__":
    asyncio.run(main())
