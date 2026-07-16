"""
One-off: rotate Umesh Yadav's (PMIC Principal) login password.

His deterministic password (first 4 digits of phone + "@" + first name) was
accidentally committed in plaintext to BUILD.md in an earlier commit
(5d8aae6, already pushed to origin/main before the leak was caught and
redacted in a later commit). Git history still has it. Rather than rely
solely on scrubbing history (which can't fully guarantee no one already
has a copy), rotate the actual credential so the leaked value stops
working — this is the real fix regardless of what happens to history.

New password is a random 14-char string, not derived from the tenant's
usual phone+name convention (that convention is fine for lower-privilege
teacher accounts, but this is the Principal's full-institution-access
account, so it gets a real secret instead of a guessable one — his phone
number is also now public on the PMIC website, which made the convention
doubly weak for this specific account).
"""

import asyncio
import os

import asyncpg
import bcrypt

TENANT_SLUG = "premchandmahtoic"
PHONE = "9334679531"
NEW_PASSWORD = os.environ.get("NEW_PASSWORD")


async def main():
    if not NEW_PASSWORD:
        print("ERROR: set NEW_PASSWORD env var"); return

    database_url = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(database_url)

    tenant = await conn.fetchrow("SELECT id FROM tenants WHERE slug = $1", TENANT_SLUG)
    if not tenant:
        print(f"ERROR: tenant '{TENANT_SLUG}' not found"); await conn.close(); return

    pw_hash = bcrypt.hashpw(NEW_PASSWORD.encode(), bcrypt.gensalt()).decode()
    result = await conn.execute(
        "UPDATE users SET password_hash = $1 WHERE tenant_id = $2 AND phone_number = $3",
        pw_hash, tenant["id"], PHONE,
    )
    await conn.close()
    print(f"  {result}  (phone={PHONE})")


if __name__ == "__main__":
    asyncio.run(main())
