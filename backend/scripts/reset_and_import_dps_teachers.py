"""
Replace Daffodils Public School (DPS) mock/seed staff with the real teacher
contact directory the owner supplied directly (no source spreadsheet — the
18-row list below is transcribed verbatim from the owner's message).

Mirrors reset_and_import_dps.py's approach for students: DPS's existing
8 staff (EMP001-EMP008: Rajiv/Sunita/Manoj/Preethi/Ashok/Vandana/Suresh/
Geeta) are mock seed data (per root CLAUDE.md's 2026-06-19 note — all DPS
data was mock until the real student roster replaced it). Deletes those
staff rows (cascades to staff_class_assignments) and their linked user
logins, then imports the 18 real teachers as EMP001-EMP018.

Login convention (same as PMIC, owner-specified, tenant-specific — not a
global rule): username = phone number, password = first four digits of the
phone number + "@" + first name (Title Case).

Data notes:
  - Source gives first names + honorific ("mam"/"Sir") only, no last names,
    except two disambiguated entries and one with a parenthetical name.
    "Anita Kumari - I" / "Anita Devi - II" -> first="Anita", last="Kumari"/
    "Devi" (the "- I"/"- II" was a table disambiguator, not part of the
    name). "Deepak Sir (Shivshanker)" -> first="Deepak", last="Shivshanker".
    Everyone else -> last_name="" (staff.last_name is NOT NULL but allows
    empty string).
  - No designation or date_of_joining in the source (just name + phone).
    Both are NOT NULL on `staff`; uses placeholder designation="Teacher"
    and date_of_joining=script run date, same convention already used for
    PMIC's Dr. Prabha Rani — owner/school can correct via the dashboard.
"""

import asyncio
import os
import re
import sys
from datetime import date

import asyncpg
import bcrypt

TENANT_SLUG = "daffodilspublicschool"

PLACEHOLDER_DESIGNATION = "Teacher"
PLACEHOLDER_DOJ = date(2026, 7, 16)  # script run date; correct via dashboard

# (raw name, phone) — transcribed verbatim from the owner's teacher directory
RAW_TEACHERS = [
    ("Geeta mam", "7277080037"),
    ("Priti mam", "6206107862"),
    ("Lalita mam", "6204427649"),
    ("Kiran mam", "6200215978"),
    ("Anita Kumari - I", "6206527277"),
    ("Anita Devi - II", "9110073723"),
    ("Jyoti mam", "8709279606"),
    ("Neetu mam", "9835053534"),
    ("Nishi mam", "8340246544"),
    ("Anju mam", "6200257812"),
    ("Ravi Sir", "8271169464"),
    ("Deepak Sir (Shivshanker)", "8340707930"),
    ("Sagar Sir", "9905706281"),
    ("Mukesh Sir", "9128571093"),
    ("Amrita mam", "8340422591"),
    ("Jayanti mam", "7004659512"),
    ("Sheela mam", "8651985342"),
    ("Mili mam", "7209875862"),
]

HONORIFICS = {"mam", "sir"}


def normalise_phone(raw: str) -> str | None:
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 10 and digits[0] in "6789":
        return digits
    return None


def parse_name(raw: str) -> tuple[str, str]:
    m = re.match(r"^(.*?)\s*\(([^)]+)\)\s*$", raw)  # "Deepak Sir (Shivshanker)"
    if m:
        base, paren = m.group(1), m.group(2)
        parts = [p for p in base.split() if p.lower() not in HONORIFICS]
        return parts[0].title(), paren.title()

    base = re.sub(r"\s*-\s*[IVX]+$", "", raw)  # "Anita Kumari - I" -> "Anita Kumari"
    parts = [p for p in base.split() if p.lower() not in HONORIFICS]
    first = parts[0].title() if parts else ""
    last = " ".join(parts[1:]).title() if len(parts) > 1 else ""
    return first, last


def build_records() -> list[dict]:
    records = []
    seen_phones = set()
    for raw_name, raw_phone in RAW_TEACHERS:
        phone = normalise_phone(raw_phone)
        if not phone:
            print(f"ERROR: invalid phone for '{raw_name}': {raw_phone}")
            sys.exit(1)
        if phone in seen_phones:
            print(f"ERROR: duplicate phone {phone} in source list")
            sys.exit(1)
        seen_phones.add(phone)

        first, last = parse_name(raw_name)
        records.append({
            "first_name": first,
            "last_name": last,
            "phone": phone,
            "designation": PLACEHOLDER_DESIGNATION,
            "role": "teacher",
            "date_of_joining": PLACEHOLDER_DOJ,
            "password": f"{phone[:4]}@{first}",
        })
    return records


async def main():
    database_url = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(database_url)

    tenant = await conn.fetchrow("SELECT id FROM tenants WHERE slug = $1", TENANT_SLUG)
    if not tenant:
        print(f"ERROR: tenant '{TENANT_SLUG}' not found"); await conn.close(); return
    tenant_id = tenant["id"]

    records = build_records()
    print(f"Parsed {len(records)} teachers from the owner's list")

    async with conn.transaction():
        old_staff = await conn.fetch(
            "SELECT id, user_id, employee_no, first_name FROM staff WHERE tenant_id = $1",
            tenant_id,
        )
        old_user_ids = [r["user_id"] for r in old_staff if r["user_id"]]
        if old_staff:
            await conn.execute("DELETE FROM staff WHERE tenant_id = $1", tenant_id)
            if old_user_ids:
                await conn.execute("DELETE FROM users WHERE id = ANY($1::uuid[])", old_user_ids)
        print(f"Deleted {len(old_staff)} mock staff "
              f"({', '.join(r['employee_no'] + ' ' + r['first_name'] for r in old_staff)}) "
              f"+ {len(old_user_ids)} linked logins")

        created = 0
        for i, rec in enumerate(records, start=1):
            emp_no = f"EMP{i:03d}"
            pw_hash = bcrypt.hashpw(rec["password"].encode(), bcrypt.gensalt()).decode()
            user_row = await conn.fetchrow(
                """
                INSERT INTO users (tenant_id, phone_number, password_hash, role)
                VALUES ($1,$2,$3,$4) RETURNING id
                """,
                tenant_id, rec["phone"], pw_hash, rec["role"],
            )
            await conn.execute(
                """
                INSERT INTO staff
                    (tenant_id, user_id, employee_no, first_name, last_name,
                     phone_number, designation, date_of_joining)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                """,
                tenant_id, user_row["id"], emp_no,
                rec["first_name"], rec["last_name"], rec["phone"],
                rec["designation"], rec["date_of_joining"],
            )
            created += 1
            print(f"  {emp_no}  {rec['first_name']} {rec['last_name']:<12} login={rec['phone']}")

    await conn.close()
    print(f"\n=== Import result ===\n  created : {created}\n  errors  : 0")


if __name__ == "__main__":
    asyncio.run(main())
