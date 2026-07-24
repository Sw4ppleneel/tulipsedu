"""
Set up exam subjects for Daffodils Public School (DPS), Class 1 through Class 8.

Owner supplied the subject list directly in chat (same list for every class,
1-8): Hindi, Eng, Math, Science, S.S.T, Comp, Snk (Sanskrit), G.K, M.Sc
(Moral Science) -- "G.K / M.SC" confirmed via AskUserQuestion to be two
separate subjects, not one combined line.

Idempotent: uses services.exam.create_subject, which upserts nothing itself,
but exam_subjects has a UNIQUE (tenant_id, academic_year_id, class_id, name)
constraint (section_id IS NULL) -- a UniqueViolationError on re-run is caught
and treated as "already exists", not an error.
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

TENANT_SLUG = "daffodilspublicschool"
CLASS_NAMES = [f"Class {n}" for n in range(1, 9)]

SUBJECTS = [
    ("Hindi", None),
    ("Eng", None),
    ("Math", None),
    ("Science", None),
    ("S.S.T", None),
    ("Comp", None),
    ("Snk", "Sanskrit"),
    ("G.K", None),
    ("M.Sc", "Moral Science"),
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
    missing_classes = [n for n in CLASS_NAMES if n not in class_map]
    if missing_classes:
        print(f"ERROR: classes not found: {missing_classes}"); await conn.close(); return

    created = 0
    already_existed = 0
    errors: list[str] = []

    for class_name in CLASS_NAMES:
        class_id = class_map[class_name]
        for sort_order, (name, code) in enumerate(SUBJECTS, start=1):
            data = ExamSubjectCreate(
                academic_year_id=academic_year_id,
                class_id=class_id,
                section_id=None,
                name=name,
                subject_code=code,
                sort_order=sort_order,
            )
            try:
                async with conn.transaction():
                    await create_subject(conn, tenant_id, data)
                created += 1
            except ExamError:
                already_existed += 1
            except Exception as exc:
                errors.append(f"{class_name} / {name}: {exc}")

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
