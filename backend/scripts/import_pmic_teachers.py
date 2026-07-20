"""
Import teaching staff for Premchand Mahto Inter College (PMIC) from the
government UDISE Teacher Profile export (School_Teacher_Profile_Details.numbers,
exported to .xlsx via Numbers since UDISE only produces .numbers/.xlsx).

Creates one `users` login + one `staff` row per teacher. Idempotency key is
(first_name, last_name), not phone or list position — phone numbers in this
source are unreliable (see Sudha Tiwari below) and re-running with a fixed
employee_no-by-phone lookup previously risked overwriting the wrong staff
row. Login convention (owner-specified, tenant-specific — not a global
rule): username = phone number, password = first four digits of the phone
number + "@" + the teacher's first name (Title Case), e.g. phone
9876543210, first name "Asha" -> password "9876@Asha". (Illustrative
example only — never use a real teacher's actual phone/password here.)

Per-row exceptions (owner-approved 2026-07-16, not silent guesses):
  - SHASHI KANT KUMAR: has left the school. Permanently excluded.
  - Dr. Prabha Rani: source has no Type_of_Teacher (designation) or
    Date_of_Joining_in_Present_School (both NOT NULL on `staff`). Owner:
    import anyway, she'll set the real designation from the dashboard.
    Uses PLACEHOLDER_DESIGNATION/PLACEHOLDER_DOJ below — fix via the
    staff-edit UI, not by re-running this script.
  - SUDHA TIWARI: source lists Mobile 9334679531, identical to Umesh
    Yadav's (already confirmed correct and imported as EMP010, principal
    login). Owner: use her number as given anyway. Since `users` is unique
    on (tenant_id, phone_number), creating her login would silently
    overwrite Umesh's password/role. This script detects that collision
    generically (any phone already claimed by a *different* staff member)
    and creates her `staff` row with phone_number set as given but no
    `users` login — her real number still needs to come from the owner
    before she can log in.
"""

import asyncio
import os
import re
import sys
from datetime import date, datetime
from pathlib import Path

import asyncpg
import bcrypt
import openpyxl

TENANT_SLUG = "premchandmahtoic"
SOURCE_XLSX = (
    Path(__file__).parent.parent.parent / "School_docs" / "Premchand Mahto Inter College"
    / "School_Teacher_Profile_Details.xlsx"
)

DESIGNATION_MAP = {
    "6-Principal": "Principal",
    "8-Lecturer": "Lecturer",
}
ROLE_MAP = {
    "6-Principal": "principal",
    "8-Lecturer": "teacher",
}

EXCLUDE_NAMES = {"SHASHI KANT KUMAR"}  # has left the school
FORCE_INCLUDE_NAMES = {"Dr. Prabha Rani"}  # missing designation/DOJ; owner approved placeholders

PLACEHOLDER_DESIGNATION = "Teacher"
PLACEHOLDER_DOJ = date(2026, 7, 16)  # script run date; owner will correct via dashboard


def normalise_phone(raw) -> str | None:
    digits = re.sub(r"\D", "", str(raw) if raw is not None else "")
    if len(digits) == 10 and digits[0] in "6789":
        return digits
    return None


def parse_ddmmyyyy(cell) -> date | None:
    if cell is None:
        return None
    if isinstance(cell, (datetime, date)):
        return cell.date() if isinstance(cell, datetime) else cell
    try:
        return datetime.strptime(str(cell).strip(), "%d/%m/%Y").date()
    except ValueError:
        return None


TITLE_PREFIXES = {"dr", "mr", "mrs", "ms"}


def title_case_name(full: str) -> tuple[str, str]:
    parts = full.strip().split()
    if parts and parts[0].strip(".").lower() in TITLE_PREFIXES:
        parts = parts[1:]
    first = parts[0].title() if parts else ""
    last = " ".join(parts[1:]).title() if len(parts) > 1 else ""
    return first, last


def read_source() -> list[dict]:
    wb = openpyxl.load_workbook(SOURCE_XLSX, data_only=True)
    ws = wb["Teacher Profile"]
    rows = list(ws.iter_rows(values_only=True))
    header = rows[1]
    idx = {name: header.index(name) for name in
           ("Staff_Name", "Date_of_Birth", "Mobile",
            "Type_of_Teacher", "Date_of_Joining_in_Present_School")}

    records = []
    skipped = []
    for row in rows[2:]:
        if all(c is None for c in row):
            continue
        name_raw = str(row[idx["Staff_Name"]]).strip()
        if name_raw in EXCLUDE_NAMES:
            skipped.append(f"{name_raw} (excluded)")
            continue

        phone = normalise_phone(row[idx["Mobile"]])
        type_of_teacher = row[idx["Type_of_Teacher"]]
        doj = parse_ddmmyyyy(row[idx["Date_of_Joining_in_Present_School"]])
        dob = parse_ddmmyyyy(row[idx["Date_of_Birth"]])

        force = name_raw in FORCE_INCLUDE_NAMES
        if not phone:
            skipped.append(f"{name_raw} (no valid 10-digit phone)")
            continue
        if (not type_of_teacher or not doj) and not force:
            skipped.append(f"{name_raw} (missing designation/DOJ, not force-included)")
            continue

        designation = (DESIGNATION_MAP.get(type_of_teacher, type_of_teacher.split("-", 1)[-1])
                       if type_of_teacher else PLACEHOLDER_DESIGNATION)
        role = ROLE_MAP.get(type_of_teacher, "teacher")
        doj = doj or PLACEHOLDER_DOJ

        first, last = title_case_name(name_raw)
        records.append({
            "first_name": first,
            "last_name": last,
            "phone": phone,
            "designation": designation,
            "role": role,
            "date_of_joining": doj,
            "date_of_birth": dob,
            "password": f"{phone[:4]}@{first}",
        })

    print(f"Parsed {len(records)} importable teachers (skipped: {skipped})")
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

    existing_rows = await conn.fetch(
        "SELECT employee_no, phone_number, first_name, last_name, user_id "
        "FROM staff WHERE tenant_id = $1", tenant_id
    )
    emp_no_by_name = {(r["first_name"], r["last_name"]): r["employee_no"] for r in existing_rows}
    phone_owner = {r["phone_number"]: (r["first_name"], r["last_name"]) for r in existing_rows}
    own_user_id = {(r["first_name"], r["last_name"]): r["user_id"] for r in existing_rows}
    used_nums = {int(m.group(1)) for r in existing_rows
                 if (m := re.match(r"EMP(\d+)$", r["employee_no"]))}
    next_num = max(used_nums, default=0) + 1

    created = updated = users_created = 0
    errors: list[str] = []

    async with conn.transaction():
        for rec in records:
            name_key = (rec["first_name"], rec["last_name"])
            emp_no = emp_no_by_name.get(name_key)
            if emp_no is None:
                emp_no = f"EMP{next_num:03d}"
                next_num += 1

            phone_taken_by = phone_owner.get(rec["phone"])
            collision = phone_taken_by is not None and phone_taken_by != name_key

            try:
                user_id = own_user_id.get(name_key)
                if collision:
                    print(f"  SKIP LOGIN  {rec['first_name']} {rec['last_name']}: phone "
                          f"{rec['phone']} already belongs to {phone_taken_by[0]} {phone_taken_by[1]}"
                          " — staff row created, no login")
                else:
                    pw_hash = bcrypt.hashpw(rec["password"].encode(), bcrypt.gensalt()).decode()
                    user_row = await conn.fetchrow(
                        """
                        INSERT INTO users (tenant_id, phone_number, password_hash, role)
                        VALUES ($1,$2,$3,$4)
                        ON CONFLICT (tenant_id, phone_number)
                        DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role
                        RETURNING id, (xmax = 0) AS inserted
                        """,
                        tenant_id, rec["phone"], pw_hash, rec["role"],
                    )
                    if user_row["inserted"]:
                        users_created += 1
                    user_id = user_row["id"]
                    await conn.execute(
                        "DELETE FROM user_roles WHERE tenant_id = $1 AND user_id = $2",
                        tenant_id, user_id,
                    )
                    await conn.execute(
                        "INSERT INTO user_roles (tenant_id, user_id, role) VALUES ($1, $2, $3)",
                        tenant_id, user_id, rec["role"],
                    )

                result = await conn.fetchrow(
                    """
                    INSERT INTO staff
                        (tenant_id, user_id, employee_no, first_name, last_name,
                         phone_number, designation, date_of_joining, date_of_birth)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                    ON CONFLICT (tenant_id, employee_no)
                    DO UPDATE SET
                        user_id         = EXCLUDED.user_id,
                        first_name      = EXCLUDED.first_name,
                        last_name       = EXCLUDED.last_name,
                        phone_number    = EXCLUDED.phone_number,
                        designation     = EXCLUDED.designation,
                        date_of_joining = EXCLUDED.date_of_joining,
                        date_of_birth   = EXCLUDED.date_of_birth,
                        is_active       = TRUE
                    RETURNING (xmax = 0) AS inserted
                    """,
                    tenant_id, user_id, emp_no,
                    rec["first_name"], rec["last_name"], rec["phone"],
                    rec["designation"], rec["date_of_joining"], rec["date_of_birth"],
                )
                if result["inserted"]:
                    created += 1
                else:
                    updated += 1
                login_str = "NO LOGIN" if collision else f"login={rec['phone']} pw={rec['password']}"
                print(f"  {emp_no}  {rec['first_name']} {rec['last_name']:<15} "
                      f"{rec['designation']:<10} {login_str}")
            except Exception as exc:
                errors.append(f"{rec['first_name']} {rec['last_name']}: {exc}")

    await conn.close()

    print("\n=== Import result ===")
    print(f"  created       : {created}")
    print(f"  updated       : {updated}")
    print(f"  users_created : {users_created}")
    if errors:
        print(f"  errors        : {len(errors)}")
        for e in errors:
            print(f"    {e}")
        sys.exit(1)
    else:
        print("  errors        : 0")


if __name__ == "__main__":
    asyncio.run(main())
