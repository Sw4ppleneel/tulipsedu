"""
One-off: rotate Umesh Yadav's (PMIC Principal) login password.

His deterministic password (first 4 digits of phone + "@" + first name) was
accidentally committed in plaintext to BUILD.md in an earlier commit
(5d8aae6, already pushed to origin/main before the leak was caught and
redacted in a later commit). Git history still has it. Rather than rely
solely on scrubbing history (which can't fully guarantee no one already
has a copy), rotate the actual credential so the leaked value stops
working — this is the real fix regardless of what happens to history.

New password is generated here, server-side, with `secrets` — never
passed as a CLI arg or env var (both would just recreate the same kind of
leak in shell history/process listings on the way in). Printed once to
stdout so it can be relayed to the owner; not persisted anywhere else.
Not derived from the tenant's usual phone+name convention (fine for
lower-privilege teacher accounts, but this is the Principal's
full-institution-access account, and his phone is now public on the PMIC
website, which made the convention doubly weak for this one).
"""

import asyncio
import os
import secrets
import string

import asyncpg
import bcrypt

TENANT_SLUG = "premchandmahtoic"
PHONE = "9334679531"


def generate_password(length: int = 14) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


async def main():
    database_url = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(database_url)

    tenant = await conn.fetchrow("SELECT id FROM tenants WHERE slug = $1", TENANT_SLUG)
    if not tenant:
        print(f"ERROR: tenant '{TENANT_SLUG}' not found"); await conn.close(); return

    new_password = generate_password()
    pw_hash = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt()).decode()
    result = await conn.execute(
        "UPDATE users SET password_hash = $1 WHERE tenant_id = $2 AND phone_number = $3",
        pw_hash, tenant["id"], PHONE,
    )
    await conn.close()
    print(f"  {result}  phone={PHONE}  new_password={new_password}")


if __name__ == "__main__":
    asyncio.run(main())
