"""
Set up exam subjects for Daffodils Public School (DPS): Pre-Nursery, Nursery,
K.G. I, K.G. II.

Owner-dictated line items per class (in chat, this session), each class gets
its own list -- unlike Class 1-8 these are NOT the same list per class:

  Pre-Nursery: Hindi Written, Hindi Oral, Eng Written, Eng Oral,
               Math Written, Math Oral, Games
  Nursery:     Eng Oral, Hindi Written, Math Written, Homework,
               Eng Written, Hindi Oral, Math Oral, Rhymes
  K.G. I:      Math Written, Hindi Written, Eng Written, Homework (H.W),
               Eng Oral, Hindi Oral, Math Oral, Rhymes
  K.G. II:     Hindi, Eng, Math, Science, Storytelling, Writing Book,
               Homework, Rhymes

Modeled as plain exam_subjects rows (e.g. "Hindi Written" and "Hindi Oral"
as two independent subjects), same approach as the Class 1-8 batch --
NOT exam_components (which would roll Written+Oral into one weighted "Hindi"
total per term) because that requires per-term max_marks/weightage the owner
hasn't specified. Sort order preserves the exact order dictated per class.

Idempotent: a UniqueViolationError on (tenant_id, academic_year_id, class_id,
name) is caught and counted as already_existed, safe to re-run.
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

# class_name -> [(subject_name, subject_code), ...] in dictated order
CLASS_SUBJECTS: dict[str, list[tuple[str, str | None]]] = {
    "Pre-Nursery": [
        ("Hindi Written", None),
        ("Hindi Oral", None),
        ("Eng Written", None),
        ("Eng Oral", None),
        ("Math Written", None),
        ("Math Oral", None),
        ("Games", None),
    ],
    "Nursery": [
        ("Eng Oral", None),
        ("Hindi Written", None),
        ("Math Written", None),
        ("Homework", None),
        ("Eng Written", None),
        ("Hindi Oral", None),
        ("Math Oral", None),
        ("Rhymes", None),
    ],
    "K.G. I": [
        ("Math Written", None),
        ("Hindi Written", None),
        ("Eng Written", None),
        ("Homework", "H.W"),
        ("Eng Oral", None),
        ("Hindi Oral", None),
        ("Math Oral", None),
        ("Rhymes", None),
    ],
    "K.G. II": [
        ("Hindi", None),
        ("Eng", None),
        ("Math", None),
        ("Science", None),
        ("Storytelling", None),
        ("Writing Book", None),
        ("Homework", None),
        ("Rhymes", None),
    ],
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
        tenant_id, list(CLASS_SUBJECTS.keys()),
    )
    class_map = {r["name"]: r["id"] for r in classes}
    missing_classes = [n for n in CLASS_SUBJECTS if n not in class_map]
    if missing_classes:
        print(f"ERROR: classes not found: {missing_classes}"); await conn.close(); return

    created = 0
    already_existed = 0
    errors: list[str] = []

    for class_name, subjects in CLASS_SUBJECTS.items():
        class_id = class_map[class_name]
        for sort_order, (name, code) in enumerate(subjects, start=1):
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
