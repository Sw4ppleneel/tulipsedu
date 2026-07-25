"""
Correct Seema Mamta Minz's (PMIC, EMP003) phone number: 9751568265 ->
9771568265 (owner-supplied correction). She already has an active login,
so both staff.phone_number (contact) and users.phone_number (login
identifier) must be updated together -- update_staff alone only touches
the staff row, which would desync the two.

password_hash is deliberately left untouched: this is a contact
correction, not a credential reset -- she keeps logging in with whatever
password she has now, just under the corrected phone number.
"""

import asyncio
import os
import sys

import asyncpg

TENANT_SLUG = "premchandmahtoic"
EMPLOYEE_NO = "EMP003"
EXPECTED_FIRST, EXPECTED_LAST = "Seema", "Mamta Minz"
OLD_PHONE = "9751568265"
NEW_PHONE = "9771568265"


async def main():
    database_url = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(database_url)

    tenant = await conn.fetchrow("SELECT id FROM tenants WHERE slug = $1", TENANT_SLUG)
    if not tenant:
        print(f"ERROR: tenant '{TENANT_SLUG}' not found"); await conn.close(); return
    tenant_id = tenant["id"]

    staff = await conn.fetchrow(
        "SELECT id, user_id, first_name, last_name, phone_number FROM staff WHERE tenant_id = $1 AND employee_no = $2",
        tenant_id, EMPLOYEE_NO,
    )
    if not staff:
        print(f"ERROR: {EMPLOYEE_NO} not found"); await conn.close(); return
    if staff["first_name"] != EXPECTED_FIRST or staff["last_name"] != EXPECTED_LAST:
        print(f"ERROR: name mismatch — expected {EXPECTED_FIRST} {EXPECTED_LAST}, "
              f"found {staff['first_name']} {staff['last_name']}"); await conn.close(); return
    if staff["phone_number"] != OLD_PHONE:
        print(f"ERROR: expected current phone {OLD_PHONE}, found {staff['phone_number']} — refusing, re-check"); await conn.close(); return

    collision = await conn.fetchrow(
        "SELECT first_name, last_name FROM staff WHERE tenant_id = $1 AND phone_number = $2 AND id != $3",
        tenant_id, NEW_PHONE, staff["id"],
    )
    if collision:
        print(f"ERROR: {NEW_PHONE} already belongs to {collision['first_name']} {collision['last_name']} — refusing"); await conn.close(); return

    async with conn.transaction():
        await conn.execute(
            "UPDATE staff SET phone_number = $1 WHERE id = $2 AND tenant_id = $3",
            NEW_PHONE, staff["id"], tenant_id,
        )
        if staff["user_id"]:
            await conn.execute(
                "UPDATE users SET phone_number = $1 WHERE id = $2 AND tenant_id = $3",
                NEW_PHONE, staff["user_id"], tenant_id,
            )

    await conn.close()
    print(f"OK  {EXPECTED_FIRST} {EXPECTED_LAST} ({EMPLOYEE_NO})  phone {OLD_PHONE} -> {NEW_PHONE}  "
          f"login updated={'yes' if staff['user_id'] else 'no login on file'}  password unchanged")


if __name__ == "__main__":
    asyncio.run(main())
