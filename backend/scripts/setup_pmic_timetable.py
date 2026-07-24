"""
Populate timetable_slots for Premchand Mahto Inter College (PMIC), Class 11
& 12, all three streams -- transcribed directly from the three official
weekly routines (School_docs/.../Routines/): Routine_Arts.pdf,
Routine_Science.pdf, Routine_Commerce.jpeg.

Period times (Science/Commerce, 4 periods/day):
  P1 09:15-10:00  P2 10:00-10:40  P3 10:40-11:20  P4 11:20-12:00
Arts has a 5th period after a lunch break (12:00-12:20, not modeled --
not a subject):
  P1 09:15-10:00  P2 10:00-10:40  P3 10:40-11:20  P4 11:20-12:00
  P5 12:20-13:00
Assembly (09:00-09:15) is not a subject period and is not modeled.
day_of_week: 1=Monday .. 6=Saturday (models/timetable.py DAY_NAMES).

Subject text is the full name, expanded from the routine's short codes.
Arts language periods split into simultaneous sub-groups the school's own
routine already writes as one combined cell (e.g. "HNA/ENA" = the Hindi
group and the English group attend at the same time) -- timetable_slots
has one subject per (class, section, day, period), so these are recorded
as a single combined label exactly as the routine presents them, e.g.
"Hindi / English". If per-group rows are ever wanted, that needs a schema
change (multiple slots per period) -- out of scope here.

staff_id is left NULL throughout. The teacher-subject PDF used for the
exam-subjects setup doesn't cleanly resolve to one teacher per period
(e.g. Umesh Yadav and Xavier Bara both cover ACT/ETP/ECO with no split
given; Sagar Lohra, named for CMS/CHE, isn't even in the staff table yet)
-- guessing would put wrong names on a real timetable. Fill in once the
owner confirms who teaches which period.

Idempotent: upsert_slot is an ON CONFLICT (..., day_of_week, period_number)
DO UPDATE, safe to re-run.
"""

import asyncio
import os
import sys
import uuid
from pathlib import Path

import asyncpg

sys.path.insert(0, str(Path(__file__).parent.parent))
from models.timetable import SlotUpsert
from services.timetable import upsert_slot

TENANT_SLUG = "premchandmahtoic"
CLASS_NAMES = ["Class 11", "Class 12"]

P4 = [("09:15", "10:00"), ("10:00", "10:40"), ("10:40", "11:20"), ("11:20", "12:00")]
P5_ARTS = P4 + [("12:20", "13:00")]

# ── Commerce (4 periods/day) ────────────────────────────────────────────────
# Mon/Tue/Wed: XI = ENA,ACT,BST,ECO ; XII = BST,ETP,ENA,ACT
# Thu/Fri/Sat: XI = BST,ETP,ENA,ACT ; XII = ENA,ACT,BST,ECO
_C_A = ["English", "Accountancy", "Business Studies", "Economics"]
_C_B = ["Business Studies", "Entrepreneurship", "English", "Accountancy"]
COMMERCE = {
    "Class 11": {1: _C_A, 2: _C_A, 3: _C_A, 4: _C_B, 5: _C_B, 6: _C_B},
    "Class 12": {1: _C_B, 2: _C_B, 3: _C_B, 4: _C_A, 5: _C_A, 6: _C_A},
}

# ── Science (4 periods/day) ──────────────────────────────────────────────────
# Mon/Tue/Wed: XI = ENA,MATH,CMS,ECO ; XII = PHY,BIO,ENA,CHE
# Thu/Fri/Sat: XI = PHY,BIO,ENA,CHE  ; XII = ENA,MATH,CMS,ECO
_S_A = ["English", "Mathematics", "Computer Science", "Economics"]
_S_B = ["Physics", "Biology", "English", "Chemistry"]
SCIENCE = {
    "Class 11": {1: _S_A, 2: _S_A, 3: _S_A, 4: _S_B, 5: _S_B, 6: _S_B},
    "Class 12": {1: _S_B, 2: _S_B, 3: _S_B, 4: _S_A, 5: _S_A, 6: _S_A},
}

# ── Arts (5 periods/day, day 6 has no P5) ────────────────────────────────────
HE   = "Hindi / English"
HEC  = "Hindi / English (Core)"
HU   = "Hindi / Urdu"
HUE  = "Hindi / Urdu / English"
ARTS = {
    "Class 11": {
        1: ["Anthropology", HE, "Political Science", "Geography", HUE],
        2: ["History", HUE, "Geography", HE, "Political Science"],
        3: ["Political Science", HE, "Anthropology", "Geography", HUE],
        4: ["History", HE, "Anthropology", "Geography", HUE],
        5: ["History", HE, "Political Science", "Geography", HUE],
        6: ["Anthropology", HE, "Geography", "Political Science"],  # no P5 Saturday
    },
    "Class 12": {
        1: [HE, "Geography", "Anthropology", HU, "Political Science"],
        2: [HE, "History", "Political Science", "Geography", HU],
        3: [HE, "Geography", "Political Science", HU, "Anthropology"],
        4: [HEC, "History", "Geography", HU, "Political Science"],
        5: [HEC, "History", "Geography", HU, "Anthropology"],
        6: [HEC, "Geography", "Political Science", HU],  # no P5 Saturday
    },
}


async def upsert_stream(conn, tenant_id, academic_year_id, class_map, section_map,
                         stream: str, data: dict, periods: list[tuple[str, str]]) -> tuple[int, list[str]]:
    count = 0
    errs: list[str] = []
    for class_name, days in data.items():
        class_id = class_map[class_name]
        section_id = section_map[(class_name, stream)]
        for day, subjects in days.items():
            for period_number, subject in enumerate(subjects, start=1):
                if subject is None:
                    continue
                start, end = periods[period_number - 1]
                slot = SlotUpsert(
                    academic_year_id=academic_year_id,
                    class_id=class_id,
                    section_id=section_id,
                    day_of_week=day,
                    period_number=period_number,
                    start_time=start,
                    end_time=end,
                    subject=subject,
                    staff_id=None,
                    room=None,
                )
                try:
                    async with conn.transaction():
                        await upsert_slot(conn, tenant_id, slot)
                    count += 1
                except Exception as exc:
                    errs.append(f"{class_name}/{stream} day{day} P{period_number}: {exc}")
    return count, errs


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

    total = 0
    all_errs: list[str] = []
    for stream, data, periods in [
        ("Commerce", COMMERCE, P4),
        ("Science", SCIENCE, P4),
        ("Arts", ARTS, P5_ARTS),
    ]:
        n, errs = await upsert_stream(conn, tenant_id, academic_year_id, class_map, section_map, stream, data, periods)
        print(f"  {stream}: {n} slots")
        total += n
        all_errs.extend(errs)

    await conn.close()

    print(f"\n=== Result ===")
    print(f"  total slots upserted: {total}")
    if all_errs:
        print(f"  errors: {len(all_errs)}")
        for e in all_errs:
            print(f"    {e}")
    else:
        print("  errors: 0")

    if all_errs:
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
