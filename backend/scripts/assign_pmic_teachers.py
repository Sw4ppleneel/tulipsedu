"""
Assign all 12 PMIC teachers to all 6 (Class 11/12 x Arts/Commerce/Science)
class/section combinations, so every teacher can mark attendance / post
homework for every class -- PMIC has no homeroom "class teacher" concept
(subject-based Inter College, teachers cross streams), and access is
gated purely by staff_class_assignments existing at all (any subject,
is_class_teacher irrelevant -- see core.rbac.load_class_scope). Owner
call: broad access, backstopped by the activity log ("we can always see
who marked the attendance").

is_class_teacher is left FALSE throughout -- it's a display flag only
(never read for permission checks), and PMIC genuinely has no homeroom
teacher, so marking everyone "class teacher" would be misleading data,
not just harmless.

For each teacher's known stream + subject(s) (from the original
teacher-subject PDF used to set up exam_subjects), one row per subject is
created for that stream's two classes -- e.g. Ashok Kumar (Physics,
Mathematics, Science) gets 4 rows: Physics/Math x Class 11/12 Science.
For every OTHER stream (where the teacher has no known subject), exactly
one subject=NULL row is created per class -- blanket attendance/homework
access with no invented subject claim.

Known gaps, not fixed here:
  - Sagar Lohra (CMS/Computer Science + Chemistry per the PDF) was never
    imported into the staff table -- can't be assigned. Flag to owner.
  - Ajay Kumar Mahtha is in staff but wasn't on the teacher-subject PDF
    at all -- gets blanket (subject=NULL) rows on every class, no
    subject-specific rows.
  - No teacher is known for English (all 3 streams) or Business Studies
    (Commerce) -- those subjects exist in exam_subjects/timetable but
    have no assignment row naming a teacher for them specifically;
    covered by the blanket rows like anyone else.

Idempotent: subject-specific rows rely on the DB's own UNIQUE constraint
(tenant_id, academic_year_id, staff_id, class_id, section_id, subject)
WHERE subject IS NOT NULL -- a duplicate raises StaffError, caught here.
Blanket (subject IS NULL) rows have no DB-level uniqueness, so this
script checks for an existing NULL-subject row for the same
(staff, class, section) before inserting.
"""

import asyncio
import os
import sys
import uuid
from pathlib import Path

import asyncpg

sys.path.insert(0, str(Path(__file__).parent.parent))
from models.staff import AssignmentCreate
from services.staff import StaffError, create_assignment

TENANT_SLUG = "premchandmahtoic"
CLASS_NAMES = ["Class 11", "Class 12"]
STREAMS = ["Arts", "Commerce", "Science"]

# (first_name, last_name) -> (stream, [subjects])  — [] means no known subject
TEACHER_SUBJECTS: dict[tuple[str, str], tuple[str, list[str]]] = {
    ("Aftabi", "Perween"):     ("Arts", ["Urdu"]),
    ("Ajay", "Kumar Mahtha"):  ("", []),
    ("Anita", "Rani"):         ("Arts", ["Psychology"]),
    ("Ashok", "Kumar"):        ("Science", ["Physics", "Mathematics"]),
    ("Hari", "Mani Subedi"):   ("Arts", ["History"]),
    ("Prabha", "Rani"):        ("Science", ["Biology"]),
    ("Sanjay", "Kumar"):       ("Arts", ["Political Science"]),
    ("Seema", "Toppo"):        ("Arts", ["Geography"]),
    ("Seema", "Mamta Minz"):   ("Arts", ["Anthropology"]),
    ("Sudha", "Tiwari"):       ("Arts", ["Hindi"]),
    ("Umesh", "Yadav"):        ("Commerce", ["Accountancy", "Entrepreneurship", "Economics"]),
    ("Xavier", "Bara"):        ("Commerce", ["Accountancy", "Entrepreneurship", "Economics"]),
}


async def main():
    database_url = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(database_url)

    tenant = await conn.fetchrow("SELECT id FROM tenants WHERE slug = $1", TENANT_SLUG)
    if not tenant:
        print(f"ERROR: tenant '{TENANT_SLUG}' not found"); await conn.close(); return
    tenant_id: uuid.UUID = tenant["id"]

    ay = await conn.fetchrow(
        "SELECT id FROM academic_years WHERE tenant_id = $1 AND is_current = TRUE", tenant_id
    )
    if not ay:
        print("ERROR: no current academic year found"); await conn.close(); return
    academic_year_id: uuid.UUID = ay["id"]

    classes = await conn.fetch(
        "SELECT id, name FROM classes WHERE tenant_id = $1 AND name = ANY($2::text[])",
        tenant_id, CLASS_NAMES,
    )
    class_map = {r["name"]: r["id"] for r in classes}

    sections = await conn.fetch(
        """
        SELECT c.name AS class_name, s.name AS section_name, s.id AS section_id
        FROM sections s JOIN classes c ON c.id = s.class_id
        WHERE s.tenant_id = $1 AND c.name = ANY($2::text[])
        """,
        tenant_id, CLASS_NAMES,
    )
    section_map = {(r["class_name"], r["section_name"]): r["section_id"] for r in sections}

    staff_rows = await conn.fetch(
        "SELECT id, first_name, last_name FROM staff WHERE tenant_id = $1 AND is_active = TRUE",
        tenant_id,
    )

    created = 0
    already_existed = 0
    skipped_unknown_staff: list[str] = []
    errors: list[str] = []

    for s in staff_rows:
        key = (s["first_name"], s["last_name"])
        if key not in TEACHER_SUBJECTS:
            skipped_unknown_staff.append(f"{s['first_name']} {s['last_name']}")
            continue
        home_stream, subjects = TEACHER_SUBJECTS[key]

        for class_name in CLASS_NAMES:
            class_id = class_map[class_name]
            for stream in STREAMS:
                section_id = section_map[(class_name, stream)]

                if stream == home_stream and subjects:
                    for subject in subjects:
                        data = AssignmentCreate(
                            academic_year_id=academic_year_id, class_id=class_id,
                            section_id=section_id, subject=subject, is_class_teacher=False,
                        )
                        try:
                            async with conn.transaction():
                                await create_assignment(conn, tenant_id, s["id"], data)
                            created += 1
                        except StaffError:
                            already_existed += 1
                        except Exception as exc:
                            errors.append(f"{s['first_name']} {s['last_name']} / {class_name} / {stream} / {subject}: {exc}")
                else:
                    exists = await conn.fetchval(
                        """
                        SELECT 1 FROM staff_class_assignments
                        WHERE tenant_id = $1 AND staff_id = $2 AND academic_year_id = $3
                          AND class_id = $4 AND section_id = $5 AND subject IS NULL
                        """,
                        tenant_id, s["id"], academic_year_id, class_id, section_id,
                    )
                    if exists:
                        already_existed += 1
                        continue
                    data = AssignmentCreate(
                        academic_year_id=academic_year_id, class_id=class_id,
                        section_id=section_id, subject=None, is_class_teacher=False,
                    )
                    try:
                        async with conn.transaction():
                            await create_assignment(conn, tenant_id, s["id"], data)
                        created += 1
                    except Exception as exc:
                        errors.append(f"{s['first_name']} {s['last_name']} / {class_name} / {stream} / (blanket): {exc}")

    await conn.close()

    print("\n=== Result ===")
    print(f"  created            : {created}")
    print(f"  already_existed    : {already_existed}")
    if skipped_unknown_staff:
        print(f"  skipped (no mapping entry): {skipped_unknown_staff}")
    if errors:
        print(f"  errors             : {len(errors)}")
        for e in errors:
            print(f"    {e}")
    else:
        print("  errors             : 0")

    if errors:
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
