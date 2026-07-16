"""
Replace Daffodils Public School (DPS) staff with the real roster from
School_docs/Daffodils/STAFF INFO.xlsx (27 people: teaching + support staff,
with real designation/department/date of joining/date of birth/role).

Supersedes the 2026-07-16 version of this script, which only had an 18-name
teacher directory (name + phone, no designations) pasted directly in chat.
That version wiped the 8 mock EMP001-EMP008 staff and imported placeholder-
designation teachers as a stopgap. STAFF INFO.xlsx turned out to already
exist in the source folder with real designations/departments/DOJ/DOB for
27 staff (teachers + office/driver/peon/guard) — just missing phone numbers.
Phones were filled in by matching names against the same 18-teacher chat
list (see the PHONES dict in the one-off script that populated the xlsx;
not re-run here, the xlsx now has them baked in) plus Dr. Prabha Rani's
number, reused from her PMIC import (owner confirmed same person, PMIC's
Dr. Prabha Rani entry, 2026-07-16).

Wipes ALL current DPS staff (superseding the interim 18-person import, not
just the original 8 mock rows) and imports all 27 real people fresh.

Login convention (same as PMIC, owner-specified, tenant-specific — not a
global rule): username = phone number, password = first four digits of the
phone number + "@" + first name (Title Case). Only created for people with
a real phone number AND a role mappable to VALID_ROLES — 8 support staff
(office incharge, drivers, peons, guard) have no phone in either source and
get a staff record with phone_number=PLACEHOLDER_PHONE but no login.
"""

import asyncio
import io
import os
import re
import sys
from datetime import date
from pathlib import Path

import asyncpg
import bcrypt
import openpyxl
from openpyxl import Workbook

sys.path.insert(0, str(Path(__file__).parent.parent))
from services.student import import_students  # noqa: F401  (not used; keeps sys.path pattern consistent)

TENANT_SLUG = "daffodilspublicschool"
SOURCE_XLSX = Path(__file__).parent.parent.parent / "School_docs" / "Daffodils" / "STAFF INFO.xlsx"

PLACEHOLDER_PHONE = "0000000000"
PLACEHOLDER_DOJ = date(2026, 7, 16)  # script run date; correct via dashboard

VALID_ROLES = {"principal", "vice_principal", "class_teacher", "teacher", "accountant"}
ROLE_MAP = {
    "PRINCIPAL": "principal",
    "CLASS TEACHER": "class_teacher",
    "TEACHER": "teacher",
    "P.T TEACHER": "teacher",
    "ACCOUNTANT": "accountant",
    # OFFICE INCHARGE, DRIVER, PEON, GUARD -> no VALID_ROLES match, no login
}


def normalise_phone(raw) -> str | None:
    digits = re.sub(r"\D", "", str(raw) if raw is not None else "")
    if len(digits) == 10 and digits[0] in "6789":
        return digits
    return None


def parse_ddmmyyyy(cell) -> date | None:
    if cell is None:
        return None
    if isinstance(cell, date):
        return cell
    try:
        d, m, y = str(cell).strip().split(".")
        return date(int(y), int(m), int(d))
    except (ValueError, TypeError):
        return None


def title(s) -> str | None:
    return str(s).strip().title() if s else None


def read_source() -> list[dict]:
    wb = openpyxl.load_workbook(SOURCE_XLSX, data_only=True)
    ws = wb["Sheet1"]
    rows = list(ws.iter_rows(values_only=True))
    header = [str(h).strip().upper() for h in rows[0]]
    idx = {name: header.index(name) for name in
           ("FIRST NAME", "LAST NAME", "PHONE NO", "DESIGNATION", "DEPARTMENT",
            "DATE OF JOINING", "DATE OF BIRTH", "ROLE")}

    records = []
    for row in rows[1:]:
        if all(c is None for c in row):
            continue
        first_raw = row[idx["FIRST NAME"]]
        if not first_raw:
            continue
        first = title(first_raw)
        last = title(row[idx["LAST NAME"]]) or ""

        phone = normalise_phone(row[idx["PHONE NO"]])
        has_real_phone = phone is not None
        if phone is None:
            phone = PLACEHOLDER_PHONE

        designation = title(row[idx["DESIGNATION"]]) or "Staff"
        department = title(row[idx["DEPARTMENT"]])
        doj = parse_ddmmyyyy(row[idx["DATE OF JOINING"]]) or PLACEHOLDER_DOJ
        dob = parse_ddmmyyyy(row[idx["DATE OF BIRTH"]])

        role_raw = str(row[idx["ROLE"]]).strip().upper() if row[idx["ROLE"]] else ""
        role = ROLE_MAP.get(role_raw)
        create_login = has_real_phone and role in VALID_ROLES

        records.append({
            "first_name": first,
            "last_name": last,
            "phone": phone,
            "designation": designation,
            "department": department,
            "date_of_joining": doj,
            "date_of_birth": dob,
            "role": role,
            "create_login": create_login,
            "password": f"{phone[:4]}@{first}" if create_login else None,
        })

    print(f"Parsed {len(records)} staff rows "
          f"({sum(r['create_login'] for r in records)} with a login)")
    return records


async def main():
    database_url = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(database_url)

    tenant = await conn.fetchrow("SELECT id FROM tenants WHERE slug = $1", TENANT_SLUG)
    if not tenant:
        print(f"ERROR: tenant '{TENANT_SLUG}' not found"); await conn.close(); return
    tenant_id = tenant["id"]

    records = read_source()
    if not records:
        print("Nothing to import."); await conn.close(); return

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
        print(f"Deleted {len(old_staff)} existing staff + {len(old_user_ids)} linked logins")

        created = 0
        for i, rec in enumerate(records, start=1):
            emp_no = f"EMP{i:03d}"
            user_id = None
            if rec["create_login"]:
                pw_hash = bcrypt.hashpw(rec["password"].encode(), bcrypt.gensalt()).decode()
                user_row = await conn.fetchrow(
                    """
                    INSERT INTO users (tenant_id, phone_number, password_hash, role)
                    VALUES ($1,$2,$3,$4) RETURNING id
                    """,
                    tenant_id, rec["phone"], pw_hash, rec["role"],
                )
                user_id = user_row["id"]
            await conn.execute(
                """
                INSERT INTO staff
                    (tenant_id, user_id, employee_no, first_name, last_name,
                     phone_number, designation, department, date_of_joining, date_of_birth)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                """,
                tenant_id, user_id, emp_no,
                rec["first_name"], rec["last_name"], rec["phone"],
                rec["designation"], rec["department"], rec["date_of_joining"], rec["date_of_birth"],
            )
            created += 1
            login_str = f"login={rec['phone']}" if rec["create_login"] else "no login"
            print(f"  {emp_no}  {rec['first_name']} {rec['last_name']:<10} "
                  f"{rec['designation']:<16} {login_str}")

    await conn.close()
    print(f"\n=== Import result ===\n  created : {created}\n  errors  : 0")


if __name__ == "__main__":
    asyncio.run(main())
