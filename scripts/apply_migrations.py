#!/usr/bin/env python3
"""Apply pending SQL migrations. Run with backend venv active.

Usage:
    DATABASE_URL=postgresql://... python scripts/apply_migrations.py
"""

import asyncio
import os
from pathlib import Path

import asyncpg


async def main() -> None:
    dsn = os.environ.get("DATABASE_URL", "postgresql://tulips:tulips@localhost:5432/tulipsedu")
    conn = await asyncpg.connect(dsn)

    await conn.execute("""
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version    VARCHAR(255) PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)

    migrations_dir = Path(__file__).parent.parent / "migrations"
    migration_files = sorted(migrations_dir.glob("*.sql"))

    applied = {r["version"] for r in await conn.fetch("SELECT version FROM schema_migrations")}

    pending = [f for f in migration_files if f.name not in applied]
    if not pending:
        print("No pending migrations.")
        await conn.close()
        return

    for path in pending:
        sql = path.read_text()
        async with conn.transaction():
            await conn.execute(sql)
            await conn.execute(
                "INSERT INTO schema_migrations (version) VALUES ($1)", path.name
            )
        print(f"  applied  {path.name}")

    print(f"\nDone. {len(pending)} migration(s) applied.")
    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
