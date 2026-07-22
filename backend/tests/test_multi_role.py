"""Multi-role staff support (migration 042_user_roles.sql).

A staff member can now hold more than one role at once (e.g. accountant +
teacher). These tests pin the core behaviors: role assignment is a full
replace, the JWT carries the whole role set, and load_class_scope grants
fully unrestricted class scope ONLY to true admin tier
(superadmin/principal/vice_principal) — accountant's tenant-wide reach is
for its own purpose (fee-collection roster lookup) and must not blanket-
unrestrict a combo user's teaching-scoped actions.
"""
import uuid
from datetime import date

import httpx
from jose import jwt as _jose_jwt


def _decode_unverified(token: str) -> dict:
    # The test runner doesn't share the backend container's SECRET_KEY, so
    # this reads claims without verifying the signature — fine for asserting
    # claim *contents* in a test, never for real auth.
    return _jose_jwt.get_unverified_claims(token)


def _new_staff(clients, tenant, *, phone_suffix: str) -> str:
    p = clients["principal"]
    r = p.post("/staff", json={
        "employee_no": f"MRT{phone_suffix}",
        "first_name": "Multi", "last_name": f"Role{phone_suffix}",
        "phone_number": f"70000{phone_suffix}",
        "designation": "Lecturer",
        "date_of_joining": "2020-04-01",
    })
    assert r.status_code == 201, f"staff create: {r.status_code} {r.text[:200]}"
    return r.json()["id"]


def test_assign_multiple_roles_reflected(clients, tenant):
    staff_id = _new_staff(clients, tenant, phone_suffix="00001")
    p = clients["principal"]

    r = p.put(f"/staff/{staff_id}/roles", json={"roles": ["accountant", "teacher"]})
    assert r.status_code == 200, f"assign roles: {r.status_code} {r.text[:200]}"

    got = p.get(f"/staff/{staff_id}")
    assert got.status_code == 200
    assert set(got.json()["roles"]) == {"accountant", "teacher"}


def test_assign_roles_rejects_empty_list(clients, tenant):
    staff_id = _new_staff(clients, tenant, phone_suffix="00002")
    r = clients["principal"].put(f"/staff/{staff_id}/roles", json={"roles": []})
    assert r.status_code == 422, f"empty roles must be 422, got {r.status_code}: {r.text[:200]}"


def test_assign_roles_rejects_invalid_role(clients, tenant):
    staff_id = _new_staff(clients, tenant, phone_suffix="00003")
    r = clients["principal"].put(f"/staff/{staff_id}/roles", json={"roles": ["dictator"]})
    assert r.status_code == 409, f"invalid role must be 409, got {r.status_code}: {r.text[:200]}"


def test_assign_roles_is_full_replace_not_additive(clients, tenant, db):
    staff_id = _new_staff(clients, tenant, phone_suffix="00004")
    p = clients["principal"]

    r1 = p.put(f"/staff/{staff_id}/roles", json={"roles": ["teacher"]})
    assert r1.status_code == 200, r1.text[:200]
    user_id = r1.json()["staff"]["user_id"]

    r2 = p.put(f"/staff/{staff_id}/roles", json={"roles": ["accountant"]})
    assert r2.status_code == 200, r2.text[:200]

    rows = db("SELECT role FROM user_roles WHERE user_id = $1", uuid.UUID(user_id))
    roles = {row["role"] for row in rows}
    assert roles == {"accountant"}, f"re-assign must fully replace, not add: {roles}"


def test_login_jwt_carries_full_role_set(clients, tenant):
    staff_id = _new_staff(clients, tenant, phone_suffix="00005")
    p = clients["principal"]
    phone = "7000000005"

    r = p.put(f"/staff/{staff_id}/roles", json={"roles": ["accountant", "teacher"]})
    assert r.status_code == 200, r.text[:200]
    password = r.json()["generated_password"]
    assert password, "expected a generated_password on first login creation"

    login = clients["anon"].post("/auth/login", json={"phone_number": phone, "password": password})
    assert login.status_code == 200, f"login: {login.status_code} {login.text[:200]}"
    claims = _decode_unverified(login.json()["access_token"])
    assert set(claims["roles"]) == {"accountant", "teacher"}


def test_combo_accountant_teacher_is_class_scoped_not_unrestricted(clients, tenant):
    """accountant must NOT blanket-unrestrict a combo user's TEACHING-scoped
    actions. An accountant+teacher with zero actual class assignments must be
    scoped exactly like a bare teacher would be (i.e. rejected here) — only
    true admin tier (superadmin/principal/vice_principal) gets unrestricted
    class scope. (Previously this combo got unrestricted access — the same
    breadth as a principal — which was a real overshoot, since accountant's
    tenant-wide reach is meant for fee collection, not teaching actions.)"""
    staff_id = _new_staff(clients, tenant, phone_suffix="00006")
    p = clients["principal"]
    phone = "7000000006"

    r = p.put(f"/staff/{staff_id}/roles", json={"roles": ["accountant", "teacher"]})
    assert r.status_code == 200, r.text[:200]
    password = r.json()["generated_password"]

    login = clients["anon"].post("/auth/login", json={"phone_number": phone, "password": password})
    assert login.status_code == 200, login.text[:200]
    token = login.json()["access_token"]

    combo = httpx.Client(
        base_url=p.base_url,
        headers={"X-Tenant-Slug": tenant["slug"], "Authorization": f"Bearer {token}"},
        timeout=30,
    )
    try:
        # This user has NO staff_class_assignments row at all, so their real
        # teaching scope is empty — must be rejected, not blanket-allowed.
        resp = combo.post("/attendance/sessions", json={
            "academic_year_id": tenant["ay"], "class_id": tenant["cls"],
            "section_id": tenant["sec"], "date": str(date.today()),
        })
        assert resp.status_code == 403, (
            f"combo accountant+teacher with no class assignments must be scoped "
            f"like a bare teacher (403), got {resp.status_code}: {resp.text[:200]}"
        )
        # But the roster (fee-collection lookup) must still be fully visible —
        # accountant's tenant-wide reach is legitimate there, independent of
        # class_scope.
        roster = combo.get("/students", params={"limit": 5})
        assert roster.status_code == 200, (
            f"accountant (even combined with teacher) must see the full roster "
            f"for fee collection, got {roster.status_code}: {roster.text[:200]}"
        )
    finally:
        combo.close()


def test_refresh_reflects_role_change_not_stale_claims(clients, tenant, db):
    """/auth/refresh must re-query current roles rather than trusting the
    refresh token's own (possibly stale) claims."""
    staff_id = _new_staff(clients, tenant, phone_suffix="00007")
    p = clients["principal"]
    phone = "7000000007"

    r = p.put(f"/staff/{staff_id}/roles", json={"roles": ["teacher"]})
    assert r.status_code == 200, r.text[:200]
    password = r.json()["generated_password"]

    login = clients["anon"].post("/auth/login", json={"phone_number": phone, "password": password})
    assert login.status_code == 200, login.text[:200]
    refresh_token = login.json()["refresh_token"]

    # Role changes after the original login — the stale refresh token still
    # only knows about "teacher".
    r2 = p.put(f"/staff/{staff_id}/roles", json={"roles": ["accountant"]})
    assert r2.status_code == 200, r2.text[:200]

    refreshed = clients["anon"].post("/auth/refresh", json={"refresh_token": refresh_token})
    assert refreshed.status_code == 200, f"refresh: {refreshed.status_code} {refreshed.text[:200]}"
    claims = _decode_unverified(refreshed.json()["access_token"])
    assert claims["roles"] == ["accountant"], (
        f"refresh must reflect the NEW role set, not the stale token's claims: {claims['roles']}"
    )
