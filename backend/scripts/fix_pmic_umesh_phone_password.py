"""
Correct Umesh Yadav's (PMIC, EMP010, Principal) phone number and reset his
password to match, owner-supplied: 9334679531 -> 9334721436.

Unlike the earlier Seema Mamta Minz correction (phone fixed first,
password reset requested as a separate follow-up), the owner asked for
both together here -- updates staff.phone_number, users.phone_number
(login identifier), and users.password_hash (standard convention,
phone[:4] + "@" + FirstName, computed not hardcoded) in one transaction.
"""

import asyncio
import os

import asyncpg
import bcrypt

TENANT_SLUG = "premchandmahtoic"
EMPLOYEE_NO = "EMP010"
EXPECTED_FIRST, EXPECTED_LAST = "Umesh", "Yadav"
OLD_PHONE = "9334679531"
NEW_PHONE = "9334721436"


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
    if not staff["user_id"]:
        print(f"ERROR: {EMPLOYEE_NO} has no login to update"); await conn.close(); return

    collision = await conn.fetchrow(
        "SELECT first_name, last_name FROM staff WHERE tenant_id = $1 AND phone_number = $2 AND id != $3",
        tenant_id, NEW_PHONE, staff["id"],
    )
    if collision:
        print(f"ERROR: {NEW_PHONE} already belongs to {collision['first_name']} {collision['last_name']} — refusing"); await conn.close(); return

    password = f"{NEW_PHONE[:4]}@{EXPECTED_FIRST.title()}"
    pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

    async with conn.transaction():
        await conn.execute(
            "UPDATE staff SET phone_number = $1 WHERE id = $2 AND tenant_id = $3",
            NEW_PHONE, staff["id"], tenant_id,
        )
        await conn.execute(
            "UPDATE users SET phone_number = $1, password_hash = $2 WHERE id = $3 AND tenant_id = $4",
            NEW_PHONE, pw_hash, staff["user_id"], tenant_id,
        )

    await conn.close()
    print(f"OK  {EXPECTED_FIRST} {EXPECTED_LAST} ({EMPLOYEE_NO})  phone {OLD_PHONE} -> {NEW_PHONE}  "
          f"password reset to standard convention ({NEW_PHONE[:4]}@{EXPECTED_FIRST.title()})")


if __name__ == "__main__":
    asyncio.run(main())
