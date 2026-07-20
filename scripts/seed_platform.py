#!/usr/bin/env python3
"""Create the platform tenant and superadmin user.

The 'platform' tenant is a special tenant for cross-school superadmin access.
Superadmin logs in via X-Tenant-Slug: platform.

Usage:
    DATABASE_URL=... python scripts/seed_platform.py [phone] [password]
"""
import asyncio
import os
import sys

import asyncpg
import bcrypt as _bcrypt


async def main() -> None:
    dsn = os.environ.get("DATABASE_URL", "postgresql://tulips:tulips@localhost:5432/tulipsedu")
    phone    = sys.argv[1] if len(sys.argv) > 1 else "9000000000"
    password = sys.argv[2] if len(sys.argv) > 2 else "superadmin123"

    conn = await asyncpg.connect(dsn)

    tenant = await conn.fetchrow(
        """
        INSERT INTO tenants (slug, name, institution_type)
        VALUES ('platform', 'Tulips.edu Platform', 'platform')
        ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
        """
    )
    tenant_id = tenant["id"]
    print(f"Platform tenant: {tenant_id}")

    pw_hash = _bcrypt.hashpw(password.encode(), _bcrypt.gensalt()).decode()
    user = await conn.fetchrow(
        """
        INSERT INTO users (tenant_id, phone_number, password_hash, role)
        VALUES ($1, $2, $3, 'superadmin')
        ON CONFLICT (tenant_id, phone_number) DO UPDATE SET password_hash = EXCLUDED.password_hash
        RETURNING id
        """,
        tenant_id, phone, pw_hash,
    )
    await conn.execute("DELETE FROM user_roles WHERE tenant_id = $1 AND user_id = $2", tenant_id, user["id"])
    await conn.execute(
        "INSERT INTO user_roles (tenant_id, user_id, role) VALUES ($1, $2, 'superadmin')",
        tenant_id, user["id"],
    )
    print(f"Superadmin: {phone} → {user['id']}")
    print()
    print("Login (superadmin):")
    print("  POST http://localhost:8000/api/v1/auth/login")
    print("  Headers: X-Tenant-Slug: platform")
    print(f'  Body: {{"phone_number": "{phone}", "password": "{password}"}}')

    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
