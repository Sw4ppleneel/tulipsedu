"""
Revert a login password back to the standard convention: first four
digits of phone + "@" + first name (Title Case).

Reverses the one-off random rotation done during the 2026-07-16
leaked-password cleanup (see BUILD.md) for Umesh Yadav and Seema
Toppo. Repo is private and both will change their password on first
login anyway via the self-service flow, so the random rotation is no
longer needed.

Usage: python scripts/revert_password.py <tenant_slug> <phone> <first_name>
(all three are identifiers, not secrets — fine as CLI args. The
resulting password follows the documented standard convention, but is
deliberately never printed — only a confirmation is, so the terminal
scrollback/log for this run doesn't end up holding a live credential.)
"""

import asyncio
import os
import sys

import asyncpg
import bcrypt


async def main():
    if len(sys.argv) != 4:
        print("Usage: python scripts/revert_password.py <tenant_slug> <phone> <first_name>")
        return
    tenant_slug, phone, first_name = sys.argv[1], sys.argv[2], sys.argv[3]

    database_url = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(database_url)

    tenant = await conn.fetchrow("SELECT id FROM tenants WHERE slug = $1", tenant_slug)
    if not tenant:
        print(f"ERROR: tenant '{tenant_slug}' not found"); await conn.close(); return

    new_password = f"{phone[:4]}@{first_name.strip().title()}"
    pw_hash = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt()).decode()
    result = await conn.execute(
        "UPDATE users SET password_hash = $1 WHERE tenant_id = $2 AND phone_number = $3",
        pw_hash, tenant["id"], phone,
    )
    await conn.close()
    print(f"  {result}  tenant={tenant_slug}  phone={phone}  reverted to standard convention (phone[:4]@FirstName)")


if __name__ == "__main__":
    asyncio.run(main())
