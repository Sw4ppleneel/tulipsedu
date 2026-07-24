"""
Set up exam subjects for Premchand Mahto Inter College (PMIC), Class 11 & 12,
scoped per stream section (Science / Commerce / Arts).

Source: School_docs teacher "Name & Subject List" PDF (owner-supplied) --
a teacher-to-subject mapping, not a per-class curriculum list, so subjects
were derived from what each teacher covers and grouped by stream. Ambiguous
points resolved via AskUserQuestion:
  - "CMS" = Computer Science (Sagar Lohra, alongside Chemistry).
  - English added as compulsory to all three streams even though it wasn't
    on the teacher list (no teacher listed for it in this document).
  - Economics kept Commerce-only for now -- owner: don't guess cross-stream
    subjects, more section-wise additions to follow separately.

Same subject set applies to both Class 11 and Class 12 (JAC Intermediate,
two-year programme, same stream curriculum both years).

Idempotent: a UniqueViolationError on (tenant_id, academic_year_id, class_id,
section_id, name) is caught and counted as already_existed, safe to re-run.
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

# stream (section name) -> [(subject_name, subject_code), ...] in display order
STREAM_SUBJECTS: dict[str, list[tuple[str, str | None]]] = {
    "Science": [
        ("English", None),
        ("Physics", None),
        ("Chemistry", None),
        ("Mathematics", None),
        ("Biology", None),
        ("Computer Science", None),
    ],
    "Commerce": [
        ("English", None),
        ("Accountancy", None),
        ("Entrepreneurship", None),
        ("Economics", None),
    ],
    "Arts": [
        ("English", None),
        ("Political Science", None),
        ("History", None),
        ("Hindi", None),
        ("Psychology", None),
        ("Urdu", None),
        ("Geography", None),
        ("Anthropology", None),
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
        tenant_id, CLASS_NAMES,
    )
    class_map = {r["name"]: r["id"] for r in classes}
    missing_classes = [n for n in CLASS_NAMES if n not in class_map]
    if missing_classes:
        print(f"ERROR: classes not found: {missing_classes}"); await conn.close(); return

    sections = await conn.fetch(
        """
        SELECT c.name AS class_name, s.name AS section_name, s.id AS section_id
        FROM sections s JOIN classes c ON c.id = s.class_id
        WHERE s.tenant_id = $1 AND c.name = ANY($2::text[])
        """,
        tenant_id, CLASS_NAMES,
    )
    section_map = {(r["class_name"], r["section_name"]): r["section_id"] for r in sections}
    missing_sections = [
        (cn, sn) for cn in CLASS_NAMES for sn in STREAM_SUBJECTS if (cn, sn) not in section_map
    ]
    if missing_sections:
        print(f"ERROR: sections not found: {missing_sections}"); await conn.close(); return

    created = 0
    already_existed = 0
    errors: list[str] = []

    for class_name in CLASS_NAMES:
        for stream, subjects in STREAM_SUBJECTS.items():
            section_id = section_map[(class_name, stream)]
            for sort_order, (name, code) in enumerate(subjects, start=1):
                data = ExamSubjectCreate(
                    academic_year_id=academic_year_id,
                    class_id=class_map[class_name],
                    section_id=section_id,
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
                    errors.append(f"{class_name} / {stream} / {name}: {exc}")

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
