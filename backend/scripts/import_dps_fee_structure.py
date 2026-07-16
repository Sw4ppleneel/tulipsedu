"""
Import DPS's real fee structure and generate the ledger for every active
student in the current academic year, in one atomic call
(services.finance.import_and_generate — the only supported way to set up
fees per that function's own docstring).

Source: School_docs/Daffodils/DPS_Fee_Structure_Import.xlsx, built earlier
this project and held back pending owner confirmation on Bus Fee's cadence.
Owner confirmed 2026-07-16: Bus Fee is monthly, Rs 700 (student_filter=
transport, i.e. only students with is_transport=TRUE get it). Also added a
Pre-Nursery Tuition Fee row (same Rs 700 Nursery-U.KG band) since that class
didn't exist when the file was first built.
"""

import asyncio
import os
import sys
from pathlib import Path

import asyncpg

sys.path.insert(0, str(Path(__file__).parent.parent))
from services.finance import import_and_generate

TENANT_SLUG = "daffodilspublicschool"
SOURCE_XLSX = Path(__file__).parent.parent.parent / "School_docs" / "Daffodils" / "DPS_Fee_Structure_Import.xlsx"


async def main():
    database_url = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(database_url)

    tenant = await conn.fetchrow("SELECT id FROM tenants WHERE slug = $1", TENANT_SLUG)
    if not tenant:
        print(f"ERROR: tenant '{TENANT_SLUG}' not found"); await conn.close(); return
    tenant_id = tenant["id"]

    ay = await conn.fetchrow(
        "SELECT id FROM academic_years WHERE tenant_id = $1 AND is_current = TRUE", tenant_id
    )
    if not ay:
        print("ERROR: no current academic year found"); await conn.close(); return

    file_bytes = SOURCE_XLSX.read_bytes()
    result = await import_and_generate(conn, tenant_id, ay["id"], file_bytes)
    await conn.close()

    print("=== Fee structure import result ===")
    for k, v in result.items():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    asyncio.run(main())
