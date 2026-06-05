#!/usr/bin/env python3
"""Create a tenant and admin user for local development.

Usage:
    python scripts/seed_tenant.py [slug] [name] [phone] [password]

Defaults: slug=demo, name="Demo School", phone=9999999999, password=admin1234
"""

import asyncio
import os
import sys

import bcrypt as _bcrypt

import asyncpg


async def main() -> None:
    dsn = os.environ.get("DATABASE_URL", "postgresql://tulips:tulips@localhost:5432/tulipsedu")

    slug = sys.argv[1] if len(sys.argv) > 1 else "demo"
    name = sys.argv[2] if len(sys.argv) > 2 else "Demo School"
    phone = sys.argv[3] if len(sys.argv) > 3 else "9999999999"
    password = sys.argv[4] if len(sys.argv) > 4 else "admin1234"

    conn = await asyncpg.connect(dsn)

    tenant = await conn.fetchrow(
        """
        INSERT INTO tenants (slug, name)
        VALUES ($1, $2)
        ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
        """,
        slug,
        name,
    )
    tenant_id = tenant["id"]
    print(f"Tenant : {name} ({slug}) → {tenant_id}")

    pw_hash = _bcrypt.hashpw(password.encode(), _bcrypt.gensalt()).decode()
    user = await conn.fetchrow(
        """
        INSERT INTO users (tenant_id, phone_number, password_hash, role)
        VALUES ($1, $2, $3, 'principal')
        ON CONFLICT (tenant_id, phone_number) DO UPDATE SET password_hash = EXCLUDED.password_hash
        RETURNING id
        """,
        tenant_id,
        phone,
        pw_hash,
    )
    print(f"Admin  : {phone} → {user['id']}")
    print()
    print("Local dev login (pass X-Tenant-Slug header):")
    print(f"  POST http://localhost:8000/api/v1/auth/login")
    print(f'  Headers: X-Tenant-Slug: {slug}')
    print(f'  Body: {{"phone_number": "{phone}", "password": "{password}"}}')

    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
