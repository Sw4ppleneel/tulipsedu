"""
Add two subjects PMIC's exam-subject setup was missing, discovered by
cross-checking the official weekly routines (School_docs/Premchand Mahto
Inter College/Routines/) against what was set up from the teacher-subject
PDF alone:

  - Commerce: "Business Studies" (routine code BST) -- the teacher PDF
    only named ACT/ETP/ECO per teacher, so BST had no listed teacher and
    was missed.
  - Science: "Economics" (routine code ECO) -- Science offers Economics
    as an additional subject alongside Physics/Chemistry/Math/Biology/
    Computer Science; not obvious from the teacher PDF since no Science
    teacher was named against ECO there either.

Appended at the end of each stream's existing sort order (not a
renumbering) for both Class 11 and Class 12. Idempotent: a
UniqueViolationError is caught and counted as already_existed.
"""

import asyncio
import os
import sys
import uuid
from pathlib import Path

import asyncpg

sys.path.insert(0, str(Path(__file__).parent.parent))
from models.exam import ExamSubjectCreate
from services.exam import ExamError, create_subject

TENANT_SLUG = "premchandmahtoic"
CLASS_NAMES = ["Class 11", "Class 12"]

# (stream, subject_name)
ADDITIONS = [
    ("Commerce", "Business Studies"),
    ("Science", "Economics"),
]


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

    created = 0
    already_existed = 0
    errors: list[str] = []

    for class_name in CLASS_NAMES:
        class_id = class_map[class_name]
        for stream, subject_name in ADDITIONS:
            section = await conn.fetchrow(
                "SELECT id FROM sections WHERE tenant_id = $1 AND class_id = $2 AND name = $3",
                tenant_id, class_id, stream,
            )
            if not section:
                errors.append(f"{class_name} / {stream}: section not found"); continue

            max_sort = await conn.fetchval(
                """
                SELECT COALESCE(MAX(sort_order), 0) FROM exam_subjects
                WHERE tenant_id = $1 AND academic_year_id = $2 AND class_id = $3 AND section_id = $4
                """,
                tenant_id, academic_year_id, class_id, section["id"],
            )

            data = ExamSubjectCreate(
                academic_year_id=academic_year_id,
                class_id=class_id,
                section_id=section["id"],
                name=subject_name,
                subject_code=None,
                sort_order=max_sort + 1,
            )
            try:
                async with conn.transaction():
                    await create_subject(conn, tenant_id, data)
                created += 1
            except ExamError:
                already_existed += 1
            except Exception as exc:
                errors.append(f"{class_name} / {stream} / {subject_name}: {exc}")

    await conn.close()

    print("\n=== Result ===")
    print(f"  created        : {created}")
    print(f"  already_existed: {already_existed}")
    if errors:
        print(f"  errors         : {len(errors)}")
        for e in errors:
            print(f"    {e}")
    else:
        print("  errors         : 0")

    if errors:
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
