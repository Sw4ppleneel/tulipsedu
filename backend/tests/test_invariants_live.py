"""L3 — read-only invariant audit against the REAL tenants, as pytest.

`pytest -m live`. SELECT-only — never writes, never touches the ephemeral tenant.
Shares the CHECKS list with backend/scripts/audit_live_tenants.py so the cron and
the test assert exactly the same invariants.

Run against a DB the live tenants live in (set DATABASE_URL). One test per
invariant; failure names the offending tenant + count.
"""
import asyncio
import os
import sys

import asyncpg
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))
from audit_live_tenants import CHECKS, run  # noqa: E402

pytestmark = pytest.mark.live

DSN = os.environ.get("DATABASE_URL", "postgresql://tulips:tulips@localhost:5432/tulipsedu")


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


@pytest.fixture(scope="module")
def live_report():
    async def _go():
        conn = await asyncpg.connect(DSN)
        try:
            return await run(conn)
        finally:
            await conn.close()
    return _run(_go())


@pytest.mark.parametrize("key,desc,_sql", CHECKS, ids=[c[0] for c in CHECKS])
def test_invariant_holds_for_all_tenants(live_report, key, desc, _sql):
    offenders = {slug: row[key] for slug, row in live_report.items()
                 if row[key] != 0}
    assert not offenders, f"{desc} — violated by: {offenders}"
