"""
Follow-up to fix_pmic_seema_minz_phone.py: owner asked to also reset
Seema Mamta Minz's (PMIC, EMP003) password to match the standard
convention derived from her corrected phone number
(phone[:4] + "@" + FirstName, Title Case) -- i.e. re-derive from the new
number rather than leave her old password in place. Computed here, not
hardcoded as a literal, so it stays tied to PHONE/FIRST_NAME.
"""

import asyncio
import os

import asyncpg
import bcrypt

TENANT_SLUG = "premchandmahtoic"
EMPLOYEE_NO = "EMP003"
FIRST_NAME = "Seema"
PHONE = "9771568265"


async def main():
    database_url = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(database_url)

    tenant = await conn.fetchrow("SELECT id FROM tenants WHERE slug = $1", TENANT_SLUG)
    if not tenant:
        print(f"ERROR: tenant '{TENANT_SLUG}' not found"); await conn.close(); return
    tenant_id = tenant["id"]

    staff = await conn.fetchrow(
        "SELECT user_id, phone_number FROM staff WHERE tenant_id = $1 AND employee_no = $2",
        tenant_id, EMPLOYEE_NO,
    )
    if not staff or not staff["user_id"]:
        print(f"ERROR: {EMPLOYEE_NO} not found or has no login"); await conn.close(); return
    if staff["phone_number"] != PHONE:
        print(f"ERROR: expected phone {PHONE}, found {staff['phone_number']} — refusing"); await conn.close(); return

    password = f"{PHONE[:4]}@{FIRST_NAME.title()}"
    pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

    await conn.execute(
        "UPDATE users SET password_hash = $1 WHERE id = $2 AND tenant_id = $3",
        pw_hash, staff["user_id"], tenant_id,
    )
    await conn.close()
    print(f"OK  password reset to standard convention ({PHONE[:4]}@{FIRST_NAME.title()}) for {EMPLOYEE_NO}")


if __name__ == "__main__":
    asyncio.run(main())
