"""
Create a login for an existing staff row that doesn't have one yet
(e.g. because their real phone number arrived after the initial
import, or a collision blocked login creation at import time).

Sets staff.phone_number to the corrected number, creates the users
row with the standard convention password (phone[:4] + "@" +
FirstName, Title Case), and links staff.user_id. Refuses if the phone
is already in use by a *different* staff member in the tenant.

Usage: python scripts/create_staff_login.py <tenant_slug> <employee_no> <phone> <role>
(all four are identifiers, not secrets — fine as CLI args. The
resulting password follows the documented standard convention and is
deliberately never printed — only a confirmation is.)
"""

import asyncio
import os
import sys

import asyncpg
import bcrypt


async def main():
    if len(sys.argv) != 5:
        print("Usage: python scripts/create_staff_login.py <tenant_slug> <employee_no> <phone> <role>")
        return
    tenant_slug, employee_no, phone, role = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]

    database_url = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(database_url)

    tenant = await conn.fetchrow("SELECT id FROM tenants WHERE slug = $1", tenant_slug)
    if not tenant:
        print(f"ERROR: tenant '{tenant_slug}' not found"); await conn.close(); return
    tenant_id = tenant["id"]

    staff = await conn.fetchrow(
        "SELECT id, first_name, last_name, user_id FROM staff WHERE tenant_id = $1 AND employee_no = $2",
        tenant_id, employee_no,
    )
    if not staff:
        print(f"ERROR: no staff with employee_no {employee_no} in tenant {tenant_slug}"); await conn.close(); return
    if staff["user_id"] is not None:
        print(f"ERROR: {staff['first_name']} {staff['last_name']} already has a login (user_id set) — refusing to overwrite"); await conn.close(); return

    collision = await conn.fetchrow(
        "SELECT first_name, last_name FROM staff WHERE tenant_id = $1 AND phone_number = $2 AND id != $3",
        tenant_id, phone, staff["id"],
    )
    if collision:
        print(f"SKIP: phone {phone} already belongs to {collision['first_name']} {collision['last_name']} — not creating login")
        await conn.close(); return

    new_password = f"{phone[:4]}@{staff['first_name'].strip().title()}"
    pw_hash = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt()).decode()

    async with conn.transaction():
        user_row = await conn.fetchrow(
            """
            INSERT INTO users (tenant_id, phone_number, password_hash, role)
            VALUES ($1,$2,$3,$4)
            ON CONFLICT (tenant_id, phone_number)
            DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role
            RETURNING id
            """,
            tenant_id, phone, pw_hash, role,
        )
        await conn.execute(
            "UPDATE staff SET user_id = $1, phone_number = $2 WHERE id = $3",
            user_row["id"], phone, staff["id"],
        )

    await conn.close()
    print(f"  OK  {staff['first_name']} {staff['last_name']} ({employee_no})  login={phone}  tenant={tenant_slug}  password set to standard convention (phone[:4]@FirstName)")


if __name__ == "__main__":
    asyncio.run(main())
