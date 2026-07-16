"""
Rotate a user's login password to a fresh random secret.

Generalized from the one-off Umesh Yadav rotation (see git history) after
finding a second leaked credential (Seema Toppo's, used as a real "e.g."
example in a script docstring). New password is generated here,
server-side, with `secrets` — never passed as a CLI arg or env var (both
would recreate the same kind of leak in shell history/process listings on
the way in). Printed once to stdout for relay to the account owner; not
persisted anywhere else.

Usage: python scripts/rotate_password.py <tenant_slug> <phone>
(tenant_slug/phone are identifiers, not secrets — fine as CLI args.)
"""

import asyncio
import os
import secrets
import string
import sys

import asyncpg
import bcrypt


def generate_password(length: int = 14) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


async def main():
    if len(sys.argv) != 3:
        print("Usage: python scripts/rotate_password.py <tenant_slug> <phone>"); return
    tenant_slug, phone = sys.argv[1], sys.argv[2]

    database_url = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(database_url)

    tenant = await conn.fetchrow("SELECT id FROM tenants WHERE slug = $1", tenant_slug)
    if not tenant:
        print(f"ERROR: tenant '{tenant_slug}' not found"); await conn.close(); return

    new_password = generate_password()
    pw_hash = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt()).decode()
    result = await conn.execute(
        "UPDATE users SET password_hash = $1 WHERE tenant_id = $2 AND phone_number = $3",
        pw_hash, tenant["id"], phone,
    )
    await conn.close()
    print(f"  {result}  tenant={tenant_slug}  phone={phone}  new_password={new_password}")


if __name__ == "__main__":
    asyncio.run(main())
