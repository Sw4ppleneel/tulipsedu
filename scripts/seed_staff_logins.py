#!/usr/bin/env python3
"""Give every login-less seeded staff record a user account so each named staff
member can sign in (for testing the real system as teacher/VP/HoD/etc.).

MOCK DATA ONLY. Idempotent: re-running resets the password + role and re-links.
All staff get the same password (STAFF_PW) for easy testing. Designation is
mapped to one of the 6 valid users.role values.

Run locally:   PYTHONPATH=backend DATABASE_URL=... python scripts/seed_staff_logins.py
Run on prod:   ssh swap@62.72.13.103 'docker exec -i tulips-backend-1 python -' < scripts/seed_staff_logins.py
"""
import asyncio
import os
import sys

import asyncpg

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))
from core.security import hash_password  # noqa: E402

STAFF_PW = "Staff@2024"

# designation (free text on staff) -> valid users.role.
# Principal / Vice Principal are intentionally SKIPPED: a principal login already
# exists per school, and we don't want to mint extra elevated-role accounts.
ROLE_MAP = {
    "class teacher": "class_teacher",
    "senior teacher": "teacher",
    "head of department": "teacher",
    "teacher": "teacher",
}
SKIP_DESIGNATIONS = {"principal", "vice principal"}


def role_for(designation: str) -> str | None:
    d = (designation or "").strip().lower()
    if d in SKIP_DESIGNATIONS:
        return None  # skip — do not create a login for elevated roles
    return ROLE_MAP.get(d, "teacher")


async def main() -> None:
    dsn = os.environ.get("DATABASE_URL", "postgresql://tulips:tulips@localhost:5432/tulipsedu")
    conn = await asyncpg.connect(dsn)
    pw = hash_password(STAFF_PW)
    created = 0
    try:
        staff = await conn.fetch(
            """
            SELECT s.id, s.tenant_id, s.phone_number, s.designation, t.slug
            FROM staff s JOIN tenants t ON t.id = s.tenant_id
            WHERE s.user_id IS NULL AND t.slug <> 'platform'
            ORDER BY t.slug, s.employee_no
            """
        )
        skipped = 0
        for s in staff:
            role = role_for(s["designation"])
            if role is None:
                skipped += 1
                print(f"  {s['slug']:24} {s['phone_number']}  {s['designation']:20} -> SKIPPED (elevated)")
                continue
            uid = await conn.fetchval(
                """
                INSERT INTO users (tenant_id, phone_number, password_hash, role)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (tenant_id, phone_number)
                DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role
                RETURNING id
                """,
                s["tenant_id"], s["phone_number"], pw, role,
            )
            await conn.execute("DELETE FROM user_roles WHERE tenant_id = $1 AND user_id = $2", s["tenant_id"], uid)
            await conn.execute(
                "INSERT INTO user_roles (tenant_id, user_id, role) VALUES ($1, $2, $3)",
                s["tenant_id"], uid, role,
            )
            await conn.execute("UPDATE staff SET user_id = $1 WHERE id = $2", uid, s["id"])
            created += 1
            print(f"  {s['slug']:24} {s['phone_number']}  {s['designation']:20} -> {role}")
    finally:
        await conn.close()
    print(f"\nLinked {created} staff logins ({skipped} elevated skipped). Password for all: {STAFF_PW}")


if __name__ == "__main__":
    asyncio.run(main())
