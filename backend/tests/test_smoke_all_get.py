"""TEMP smoke: hit every parameterless GET route, flag any 5xx (broken wiring)."""
import httpx
import pytest
from main import app

GET_ROUTES = sorted({
    r.path for r in app.routes
    if getattr(r, "methods", None) and "GET" in r.methods
    and r.path.startswith("/api/v1/")
    and "{" not in r.path
})


def test_no_5xx_on_get_routes(clients, tenant):
    principal = clients["principal"]
    superadmin = clients["superadmin"]
    slug = tenant["slug"]
    anon = clients["anon"]
    results = []
    for path in GET_ROUTES:
        rel = path[len("/api/v1"):]
        client = principal
        r = client.get(rel)
        if r.status_code in (401, 403):
            r2 = superadmin.get(rel)
            if r2.status_code not in (401, 403):
                r = r2
                client = superadmin
        if r.status_code in (401, 403):
            r3 = anon.get(rel)
            if r3.status_code < 400:
                r = r3
        results.append((path, r.status_code))

    print("\n=== GET smoke results ===")
    failures = []
    for path, code in results:
        flag = "  <-- 5xx" if code >= 500 else ""
        if code >= 500:
            failures.append((path, code))
        print(f"  {code}  {path}{flag}")
    print(f"\n{len(results)} routes hit, {len(failures)} server errors")
    assert not failures, f"5xx on: {failures}"
