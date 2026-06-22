#!/usr/bin/env python3
"""Wire class assignments for the seeded staff logins so they see classes in the
teacher portal (load_class_scope reads staff_class_assignments).

MOCK DATA. Idempotent (ON CONFLICT DO NOTHING against the two partial unique
indexes). For each school:
  - every teaching login (role teacher/class_teacher) gets ONE subject assignment,
    round-robined across the classes -> the class shows up for attendance/homework.
  - the class_teacher-role staff is additionally made class-teacher of the first
    class that has no class teacher yet -> they can also see the student roster.

Run on prod: ssh swap@62.72.13.103 'docker exec -i tulips-backend-1 python -' < scripts/seed_staff_assignments.py
"""
import asyncio
import os

import asyncpg

SUBJECTS = ["Mathematics", "English", "Science", "Social Studies", "Hindi", "Computer Science"]


async def main() -> None:
    dsn = os.environ.get("DATABASE_URL", "postgresql://tulips:tulips@localhost:5432/tulipsedu")
    conn = await asyncpg.connect(dsn)
    subj_links = 0
    ct_links = 0
    try:
        tenants = await conn.fetch("SELECT id, slug FROM tenants WHERE slug <> 'platform' ORDER BY slug")
        for t in tenants:
            tid = t["id"]
            year = await conn.fetchval(
                "SELECT id FROM academic_years WHERE tenant_id=$1 AND is_current", tid
            )
            if not year:
                continue
            classes = await conn.fetch(
                """SELECT c.id AS class_id, s.id AS section_id, c.name
                   FROM classes c JOIN sections s ON s.class_id = c.id
                   WHERE c.tenant_id = $1
                   ORDER BY c.numeric_order NULLS LAST, c.name, s.name""",
                tid,
            )
            if not classes:
                continue
            staff = await conn.fetch(
                """SELECT s.id, u.role
                   FROM staff s JOIN users u ON u.id = s.user_id
                   WHERE s.tenant_id = $1 AND u.role IN ('teacher', 'class_teacher')
                   ORDER BY s.employee_no""",
                tid,
            )
            # classes that already have a class teacher (respect the partial unique)
            ct_rows = await conn.fetch(
                """SELECT class_id, section_id FROM staff_class_assignments
                   WHERE tenant_id=$1 AND academic_year_id=$2 AND is_class_teacher""",
                tid, year,
            )
            taken = {(r["class_id"], r["section_id"]) for r in ct_rows}
            ct_done = False
            for i, st in enumerate(staff):
                cls = classes[i % len(classes)]
                subj = SUBJECTS[i % len(SUBJECTS)]
                # subject-teacher assignment (makes the class visible)
                r = await conn.execute(
                    """INSERT INTO staff_class_assignments
                         (tenant_id, staff_id, academic_year_id, class_id, section_id, subject, is_class_teacher)
                       VALUES ($1,$2,$3,$4,$5,$6,FALSE) ON CONFLICT DO NOTHING""",
                    tid, st["id"], year, cls["class_id"], cls["section_id"], subj,
                )
                subj_links += int(r.split()[-1])
                # make the class_teacher-role staff a class teacher of a free class
                if st["role"] == "class_teacher" and not ct_done:
                    free = next((c for c in classes if (c["class_id"], c["section_id"]) not in taken), None)
                    if free:
                        r2 = await conn.execute(
                            """INSERT INTO staff_class_assignments
                                 (tenant_id, staff_id, academic_year_id, class_id, section_id, subject, is_class_teacher)
                               VALUES ($1,$2,$3,$4,$5,NULL,TRUE) ON CONFLICT DO NOTHING""",
                            tid, st["id"], year, free["class_id"], free["section_id"],
                        )
                        if int(r2.split()[-1]):
                            ct_links += 1
                            taken.add((free["class_id"], free["section_id"]))
                            ct_done = True
            print(f"  {t['slug']:24} {len(staff)} teaching staff wired")
    finally:
        await conn.close()
    print(f"\nCreated {subj_links} subject assignments + {ct_links} class-teacher assignments.")


if __name__ == "__main__":
    asyncio.run(main())
