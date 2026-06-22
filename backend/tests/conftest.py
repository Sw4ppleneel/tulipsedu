"""Shared fixtures for the prod-safe test suite.

WRITE tests (everything except `-m live`) run ONLY against a uniquely-slugged
ephemeral tenant created here and CASCADE-deleted at session end — they never
touch a real tenant. Mirrors backend/scripts/pipeline_smoke_test.py.

Env:
  BASE_URL      default http://localhost:8000  (the running app under test)
  DATABASE_URL  default dev DSN
"""
import asyncio
import os
import sys
import uuid
from datetime import date, datetime
from zoneinfo import ZoneInfo

import asyncpg
import httpx
import pytest

# core.security is importable when backend/ is on the path (pytest rootdir = backend)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core.security import hash_password  # noqa: E402

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8000")
DSN = os.environ.get("DATABASE_URL", "postgresql://tulips:tulips@localhost:5432/tulipsedu")
PW = "TestPass123!"
YEAR = date.today().year
# Attendance locks compute "today" in IST — open sessions for the server's IST date.
IST_TODAY = datetime.now(ZoneInfo("Asia/Kolkata")).date()

ROLES = ["principal", "vice_principal", "superadmin", "teacher", "accountant"]
_ROLE_PHONE = {r: f"90000000{i:02d}" for i, r in enumerate(ROLES, start=1)}


def _run(coro):
    """Run an async coroutine from a sync fixture/test on a fresh loop."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


async def _provision(slug: str) -> dict:
    conn = await asyncpg.connect(DSN)
    try:
        tid = await conn.fetchval(
            "INSERT INTO tenants (slug, name) VALUES ($1, $2) RETURNING id", slug, "QA Suite"
        )
        users = {}
        for role, phone in _ROLE_PHONE.items():
            uid = await conn.fetchval(
                "INSERT INTO users (tenant_id, phone_number, password_hash, role) "
                "VALUES ($1,$2,$3,$4) RETURNING id",
                tid, phone, hash_password(PW), role,
            )
            users[role] = {"id": str(uid), "phone": phone}
        ay = await conn.fetchval(
            "INSERT INTO academic_years (tenant_id, name, start_date, end_date, is_current) "
            "VALUES ($1,$2,$3,$4,true) RETURNING id",
            tid, f"{YEAR}-{YEAR+1}", date(YEAR, 4, 1), date(YEAR + 1, 3, 31),
        )
        cid = await conn.fetchval(
            "INSERT INTO classes (tenant_id, name, numeric_order) VALUES ($1,'Class 5',5) RETURNING id", tid
        )
        sid = await conn.fetchval(
            "INSERT INTO sections (tenant_id, class_id, name) VALUES ($1,$2,'A') RETURNING id", tid, cid
        )
        return {"tid": str(tid), "slug": slug, "users": users,
                "ay": str(ay), "cls": str(cid), "sec": str(sid)}
    finally:
        await conn.close()


async def _cleanup(slug: str) -> None:
    conn = await asyncpg.connect(DSN)
    try:
        await conn.execute("DELETE FROM tenants WHERE slug = $1", slug)  # cascade
    finally:
        await conn.close()


@pytest.fixture(scope="session")
def tenant():
    """An ephemeral tenant (year + class + section + role users), deleted on teardown."""
    slug = f"qa-test-{uuid.uuid4().hex[:8]}"
    ctx = _run(_provision(slug))
    yield ctx
    _run(_cleanup(slug))


def _login(slug: str, phone: str) -> str | None:
    r = httpx.post(f"{BASE_URL}/api/v1/auth/login", headers={"X-Tenant-Slug": slug},
                   json={"phone_number": phone, "password": PW}, timeout=30)
    return r.json().get("access_token") if r.status_code == 200 else None


@pytest.fixture(scope="session")
def clients(tenant):
    """Authed httpx clients keyed by role, plus an unauthenticated `anon` client."""
    slug = tenant["slug"]
    out: dict[str, httpx.Client] = {}
    for role in ROLES:
        tok = _login(slug, tenant["users"][role]["phone"])
        headers = {"X-Tenant-Slug": slug}
        if tok:
            headers["Authorization"] = f"Bearer {tok}"
        out[role] = httpx.Client(base_url=f"{BASE_URL}/api/v1", headers=headers, timeout=30)
    out["anon"] = httpx.Client(base_url=f"{BASE_URL}/api/v1",
                               headers={"X-Tenant-Slug": slug}, timeout=30)
    yield out
    for c in out.values():
        c.close()


@pytest.fixture
def db():
    """Run a read query against the DB for effect assertions: db('SELECT ...', *args) -> rows."""
    def query(sql: str, *args):
        async def _go():
            conn = await asyncpg.connect(DSN)
            try:
                return await conn.fetch(sql, *args)
            finally:
                await conn.close()
        return _run(_go())
    return query
