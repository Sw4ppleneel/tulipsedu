"""Reconcile PMIC Class 11 Arts (session 2026-28) with the owner's roster file.

Source: 'session 2026-28 Arts.xlsx' (owner-supplied, 2026-08-03). 117 rows.
107 already exist and matched the DB exactly on name -- the file is a superset
of the earlier import with 10 rows appended.

Does two things:
  1. Creates rolls 108-117 via services.student.create_student -- the SAME path
     the app uses, so each one gets its STUDENT_CREATED event and its fee ledger
     generated identically to a normally-added student. Hand-rolled INSERTs
     would have left them owing nothing while their 107 classmates owe Rs.22,500
     each (26 ledger rows apiece).
  2. Fixes roll 86's date of birth, 2000-01-01 -> 2010-09-20 (the stored value
     was a placeholder).

Deliberately NOT imported -- the students table has no column for any of them,
and the owner chose "import only required info" over a migration:
Father's Name, Mother's Name, Caste, Aadhaar No., Guardian's Aadhaar No.,
Passing Board, Passing %. Aadhaar especially is left out on purpose: storing
national ID numbers carries consent/retention obligations this schema does not
currently take on.

Roll 25 is left alone. The file gives '834075546' -- nine digits, not a valid
Indian mobile -- so importing it would replace one unusable number with another.
It stays on the 0000000000 placeholder until a real number is supplied.

Identity-keyed and idempotent: keyed on admission_no, so a rerun skips anyone
already present rather than duplicating or raising.

Values are inlined below rather than read from the .xlsx at runtime: prod has no
openpyxl and no access to the owner's Desktop, and a committed literal is
auditable against the source file.
"""

import asyncio
import os
import sys
import uuid
from datetime import date

import asyncpg

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.student import StudentCreate  # noqa: E402
from services.student import StudentError, create_student  # noqa: E402

TENANT_SLUG = "premchandmahtoic"
CLASS_NAME = "Class 11"
STREAM_NAME = "Arts"
ADMNO_PREFIX = "A-2026-"

# roll, full name, dob, mobile — verbatim from the source file.
NEW_STUDENTS = [
    (108, "GAURAV KUMAR RAJAK", date(2010, 10, 31), "8789641910"),
    (109, "ARMAN ANSARI",       date(2008, 2, 11),  "6205566958"),
    (110, "PRADEEEP KUMAR MAHTO", date(2010, 12, 10), "7903606485"),
    (111, "RAVINDRA MUNDA",     date(2007, 5, 28),  "9234146960"),
    (112, "KETAN KUMAR",        date(2008, 2, 3),   "7488006357"),
    (113, "MD. GUFRAN",         date(2008, 1, 1),   "7250864779"),
    (114, "ALISHA KUMARI",      date(2011, 9, 23),  "7258069443"),
    (115, "SONIYA KUMARI",      date(1997, 11, 5),  "8294059537"),
    (116, "VIVEK KUMAR MAHTO",  date(2009, 1, 1),   "9229532558"),
    (117, "PAWAN ORAON",        date(2008, 10, 3),  "9334572679"),
]

DOB_FIXES = [("86", date(2010, 9, 20), date(2000, 1, 1))]  # roll, new, expected-old


def split_name(full: str) -> tuple[str, str]:
    """First token is first_name, the remainder last_name — matches how the
    existing 107 were stored (e.g. 'MD' / 'FARHAN AKHTAR ANSARI')."""
    parts = full.strip().split()
    return (parts[0], " ".join(parts[1:]) if len(parts) > 1 else parts[0])


async def main():
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])

    ctx = await conn.fetchrow(
        """
        SELECT t.id AS tenant_id, c.id AS class_id, sec.id AS section_id,
               ay.id AS ay_id
        FROM tenants t
        JOIN classes c   ON c.tenant_id = t.id AND c.name = $2
        JOIN sections sec ON sec.tenant_id = t.id AND sec.class_id = c.id AND sec.name = $3
        JOIN academic_years ay ON ay.tenant_id = t.id AND ay.is_current = TRUE
        WHERE t.slug = $1
        """,
        TENANT_SLUG, CLASS_NAME, STREAM_NAME,
    )
    if not ctx:
        print(f"ERROR: could not resolve {TENANT_SLUG} / {CLASS_NAME} / {STREAM_NAME}")
        await conn.close()
        return
    tenant_id = ctx["tenant_id"]

    before = await conn.fetchval(
        "SELECT COUNT(*) FROM students WHERE tenant_id=$1 AND class_id=$2 "
        "AND section_id=$3 AND is_active",
        tenant_id, ctx["class_id"], ctx["section_id"],
    )
    print(f"Class 11 Arts before: {before} students\n")

    created = skipped = failed = 0
    for roll, full_name, dob, phone in NEW_STUDENTS:
        adm_no = f"{ADMNO_PREFIX}{roll:03d}"
        exists = await conn.fetchval(
            "SELECT 1 FROM students WHERE tenant_id=$1 AND admission_no=$2", tenant_id, adm_no
        )
        if exists:
            print(f"SKIP  {adm_no} already exists")
            skipped += 1
            continue

        first, last = split_name(full_name)
        try:
            async with conn.transaction():
                student = await create_student(
                    conn, tenant_id,
                    StudentCreate(
                        academic_year_id=ctx["ay_id"],
                        class_id=ctx["class_id"],
                        section_id=ctx["section_id"],
                        admission_no=adm_no,
                        roll_number=str(roll),
                        first_name=first,
                        last_name=last,
                        date_of_birth=dob,
                        # The roster carries no gender column; the existing 107
                        # are all 'Other' for the same reason. Not guessed from names.
                        gender="Other",
                        parent_phone=phone,
                        is_hosteler=False,
                        is_transport=False,
                    ),
                )
            n = await conn.fetchval(
                "SELECT COUNT(*) FROM fee_ledger WHERE student_id=$1", uuid.UUID(str(student.id))
            )
            print(f"OK    {adm_no}  roll {roll:>3}  {full_name[:26]:<26} fees={n}")
            created += 1
        except StudentError as e:
            print(f"FAIL  {adm_no} {full_name}: {e}")
            failed += 1

    print()
    for roll, new_dob, expected_old in DOB_FIXES:
        row = await conn.fetchrow(
            "SELECT id, first_name, last_name, date_of_birth FROM students "
            "WHERE tenant_id=$1 AND class_id=$2 AND section_id=$3 AND roll_number=$4 AND is_active",
            tenant_id, ctx["class_id"], ctx["section_id"], roll,
        )
        if not row:
            print(f"SKIP  dob fix: roll {roll} not found")
            continue
        if row["date_of_birth"] == new_dob:
            print(f"SKIP  dob fix: roll {roll} already {new_dob}")
            continue
        if row["date_of_birth"] != expected_old:
            print(f"SKIP  dob fix: roll {roll} is {row['date_of_birth']}, "
                  f"expected {expected_old} — refusing to overwrite an unexpected value")
            continue
        await conn.execute(
            "UPDATE students SET date_of_birth=$1 WHERE id=$2 AND tenant_id=$3",
            new_dob, row["id"], tenant_id,
        )
        print(f"OK    dob fix: roll {roll} {row['first_name']} {row['last_name']} "
              f"{expected_old} -> {new_dob}")

    after = await conn.fetchval(
        "SELECT COUNT(*) FROM students WHERE tenant_id=$1 AND class_id=$2 "
        "AND section_id=$3 AND is_active",
        tenant_id, ctx["class_id"], ctx["section_id"],
    )
    await conn.close()
    print(f"\ncreated={created} skipped={skipped} failed={failed}")
    print(f"Class 11 Arts after: {after} students (expected 117)")


if __name__ == "__main__":
    asyncio.run(main())
