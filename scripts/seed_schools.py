#!/usr/bin/env python3
"""
Seed 4 production schools with realistic mock data.

Usage:
    cd backend && PYTHONPATH=. DATABASE_URL=postgresql://... python ../scripts/seed_schools.py

Idempotent — safe to re-run. Uses ON CONFLICT DO NOTHING.
"""

import asyncio
import os
import random
import uuid
from datetime import date, datetime, timedelta, timezone

import asyncpg
import bcrypt

from services.receipt import IST, generate_receipt_html, period_label  # PYTHONPATH=/app (or backend)

# ── School definitions ──────────────────────────────────────────────────────

SCHOOLS = [
    {
        "slug":     "daffodilspublicschool",
        "name":     "Daffodils Public School",
        "city":     "Dhanbad",
        "admin_phone":    "9801111111",
        "admin_password": "Daffodils@2024",
    },
    {
        "slug":     "premchandhighschool",
        "name":     "Premchand High School",
        "name":     "Premchand High School",
        "city":     "Bokaro",
        "admin_phone":    "9802222222",
        "admin_password": "Premchand@2024",
    },
    {
        "slug":     "premchandmahtoic",
        "name":     "Premchand Mahto IC",
        "city":     "Hazaribagh",
        "admin_phone":    "9803333333",
        "admin_password": "PMIC@2024",
    },
    {
        "slug":     "vivekmemorialhighschool",
        "name":     "Vivek Memorial High School",
        "city":     "Ranchi",
        "admin_phone":    "9804444444",
        "admin_password": "Vivek@2024",
    },
]

# ── Name pools ───────────────────────────────────────────────────────────────

MALE_NAMES   = ["Aarav", "Vihaan", "Ishaan", "Arjun", "Rohan", "Dhruv", "Aditya",
                "Kabir", "Aryan", "Pranav", "Soham", "Vivaan", "Rehan", "Nitin", "Sahil"]
FEMALE_NAMES = ["Ananya", "Priya", "Kavya", "Divya", "Shreya", "Neha", "Pooja",
                "Riya", "Sanya", "Diya", "Meera", "Nisha", "Ankita", "Simran", "Tanya"]
SURNAMES     = ["Sharma", "Kumar", "Singh", "Verma", "Gupta", "Patel", "Yadav",
                "Mishra", "Jha", "Pandey", "Tiwari", "Dubey", "Sinha", "Roy", "Das"]

STAFF_FIRST  = ["Rajiv", "Sunita", "Manoj", "Preethi", "Ashok", "Vandana",
                "Suresh", "Geeta", "Harish", "Rekha", "Deepak", "Anita"]
DESIGNATIONS = ["Principal", "Vice Principal", "Senior Teacher", "Class Teacher",
                "Head of Department", "Teacher", "Teacher", "Teacher"]

SUBJECTS     = ["Mathematics", "Science", "English", "Hindi", "Social Science",
                "Computer Science", "Physical Education"]
CLASS_NAMES  = ["Grade 6", "Grade 7", "Grade 8", "Grade 9", "Grade 10"]

HW_POSTS = [
    ("Mathematics", "homework",     "Chapter 4 Exercise Set", "Complete all problems from Ex 4.3 and 4.4"),
    ("Science",     "homework",     "Photosynthesis Diagram", "Draw and label the process of photosynthesis"),
    ("English",     "announcement", "Essay Competition",      "Annual essay competition on 15th June. Topic: My India"),
    ("Hindi",       "resource",     "Grammar Notes",          "Revised notes on Sandhi and Samas uploaded"),
    ("Mathematics", "homework",     "Practice Test",          "Solve the practice paper for Unit Test 1"),
]

# ── Helpers ──────────────────────────────────────────────────────────────────

def rng_name(gender: str) -> tuple[str, str]:
    first = random.choice(MALE_NAMES if gender == "Male" else FEMALE_NAMES)
    last  = random.choice(SURNAMES)
    return first, last

def rng_phone() -> str:
    return "98" + str(random.randint(10_000_000, 99_999_999))

def pw_hash(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


async def _seed_paid_payment(
    conn: asyncpg.Connection, tenant_id, slug: str, school_name: str,
    student_id, ledger_id, month: int, year: int, fee_head_name: str,
) -> None:
    """Create the fee_payments/fee_payment_items row a 'paid' fee_ledger row must
    have behind it (gateway='offline', method='cash'), so seed data satisfies the
    same invariant money_reconciliation() enforces on real data. paid_at is
    backdated to the 5th of the fee period so receipts look authentic."""
    student = await conn.fetchrow(
        """
        SELECT s.first_name, s.last_name, s.admission_no,
               c.name AS class_name, sec.name AS section_name
        FROM students s
        JOIN classes c ON c.id = s.class_id
        JOIN sections sec ON sec.id = s.section_id
        WHERE s.id = $1
        """,
        student_id,
    )
    amount_due = await conn.fetchval("SELECT amount_due FROM fee_ledger WHERE id = $1", ledger_id)
    paid_at = datetime(year, month, 5, 10, 0, tzinfo=IST).astimezone(timezone.utc)

    counter = await conn.fetchval(
        """
        INSERT INTO fee_receipt_counters (tenant_id, last_number) VALUES ($1, 1)
        ON CONFLICT (tenant_id) DO UPDATE SET last_number = fee_receipt_counters.last_number + 1
        RETURNING last_number
        """,
        tenant_id,
    )
    receipt_number = f"{slug.upper()}-{year}-{counter:06d}"
    label = period_label(month, year)
    receipt_html = generate_receipt_html(
        receipt_number=receipt_number,
        school_name=school_name,
        student_name=f"{student['first_name']} {student['last_name']}",
        admission_no=student["admission_no"],
        class_section=f"{student['class_name']} — {student['section_name']}",
        payment_method="cash",
        paid_at=paid_at,
        items=[{"description": f"{label} — {fee_head_name}", "amount": amount_due}],
        total=float(amount_due),
    )

    payment_id = await conn.fetchval(
        """
        INSERT INTO fee_payments
            (tenant_id, student_id, payment_ref, gateway, amount, status,
             payment_method, receipt_number, receipt_html, paid_at, verified_at)
        VALUES ($1, $2, $3, 'offline', $4, 'paid', 'cash', $5, $6, $7, $7)
        RETURNING id
        """,
        tenant_id, student_id, str(uuid.uuid4()), amount_due, receipt_number, receipt_html, paid_at,
    )
    await conn.execute(
        "INSERT INTO fee_payment_items (tenant_id, payment_id, ledger_id, amount) VALUES ($1,$2,$3,$4)",
        tenant_id, payment_id, ledger_id, amount_due,
    )
    await conn.execute("UPDATE fee_ledger SET payment_id = $1 WHERE id = $2", payment_id, ledger_id)


# ── Seed one school ──────────────────────────────────────────────────────────

async def seed_school(conn: asyncpg.Connection, school: dict) -> None:
    slug  = school["slug"]
    name  = school["name"]
    city  = school["city"]
    print(f"\n{'='*55}")
    print(f"  {name} ({slug})")
    print(f"{'='*55}")

    # 1. Tenant
    tenant = await conn.fetchrow(
        """
        INSERT INTO tenants (slug, name)
        VALUES ($1, $2)
        ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
        """,
        slug, name,
    )
    tid = tenant["id"]
    print(f"  tenant  {tid}")

    # 2. Admin user
    h = pw_hash(school["admin_password"])
    await conn.execute(
        """
        INSERT INTO users (tenant_id, phone_number, password_hash, role)
        VALUES ($1,$2,$3,'principal')
        ON CONFLICT (tenant_id, phone_number) DO UPDATE SET password_hash = EXCLUDED.password_hash
        """,
        tid, school["admin_phone"], h,
    )
    print(f"  admin   {school['admin_phone']} / {school['admin_password']}")

    # 3. Academic year
    ay = await conn.fetchrow(
        """
        INSERT INTO academic_years (tenant_id, name, start_date, end_date, is_current)
        VALUES ($1,'2025-2026','2025-04-01','2026-03-31',TRUE)
        ON CONFLICT (tenant_id, name) DO UPDATE SET is_current = TRUE
        RETURNING id
        """,
        tid,
    )
    ay_id = ay["id"]

    # 4. Classes + sections
    class_ids   = {}
    section_ids = {}
    for order, cname in enumerate(CLASS_NAMES, 1):
        cls = await conn.fetchrow(
            """
            INSERT INTO classes (tenant_id, name, numeric_order)
            VALUES ($1,$2,$3)
            ON CONFLICT (tenant_id, name) DO UPDATE SET numeric_order = EXCLUDED.numeric_order
            RETURNING id
            """,
            tid, cname, order,
        )
        cid = cls["id"]
        class_ids[cname] = cid

        sec = await conn.fetchrow(
            """
            INSERT INTO sections (tenant_id, class_id, name)
            VALUES ($1,$2,'A')
            ON CONFLICT DO NOTHING
            RETURNING id
            """,
            tid, cid,
        )
        if sec:
            section_ids[cname] = sec["id"]
        else:
            r = await conn.fetchrow(
                "SELECT id FROM sections WHERE tenant_id=$1 AND class_id=$2 AND name='A'",
                tid, cid,
            )
            section_ids[cname] = r["id"]

    print(f"  classes {len(class_ids)} | sections {len(section_ids)}")

    # 5. Staff (8 per school)
    staff_ids = []
    random.seed(hash(slug))
    for i, desig in enumerate(DESIGNATIONS):
        first = STAFF_FIRST[i % len(STAFF_FIRST)]
        last  = random.choice(SURNAMES)
        phone = rng_phone()
        sid = await conn.fetchval(
            """
            INSERT INTO staff
                (tenant_id, employee_no, first_name, last_name, phone_number, designation, date_of_joining)
            VALUES ($1,$2,$3,$4,$5,$6,'2020-06-01')
            ON CONFLICT DO NOTHING
            RETURNING id
            """,
            tid, f"EMP{i+1:03d}", first, last, phone, desig,
        )
        if sid:
            staff_ids.append(sid)
        else:
            r = await conn.fetchrow(
                "SELECT id FROM staff WHERE tenant_id=$1 AND employee_no=$2",
                tid, f"EMP{i+1:03d}",
            )
            if r:
                staff_ids.append(r["id"])
    print(f"  staff   {len(staff_ids)}")

    # 6. Students (6 per class = 30 total)
    student_ids_by_class: dict[str, list] = {}
    for cname in CLASS_NAMES:
        cid  = class_ids[cname]
        seid = section_ids[cname]
        ids  = []
        for roll in range(1, 7):
            gender = "Male" if roll % 2 == 1 else "Female"
            fname, lname = rng_name(gender)
            adm = f"{slug[:4].upper()}{cname[-1]}{roll:02d}"
            roll_str = str(roll)
            dob = date(2010 - (int(cname[-1]) - 6), random.randint(1, 12), random.randint(1, 28))
            pphone = rng_phone()
            st = await conn.fetchrow(
                """
                INSERT INTO students
                    (tenant_id,academic_year_id,class_id,section_id,
                     admission_no,roll_number,first_name,last_name,
                     date_of_birth,gender,parent_phone)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                ON CONFLICT (tenant_id,academic_year_id,class_id,section_id,roll_number) DO NOTHING
                RETURNING id
                """,
                tid, ay_id, cid, seid,
                adm, roll_str, fname, lname,
                dob, gender, pphone,
            )
            if st:
                ids.append(st["id"])
            else:
                r = await conn.fetchrow(
                    "SELECT id FROM students WHERE tenant_id=$1 AND academic_year_id=$2 AND class_id=$3 AND section_id=$4 AND roll_number=$5",
                    tid, ay_id, cid, seid, roll_str,
                )
                if r:
                    ids.append(r["id"])
        student_ids_by_class[cname] = ids
    total_students = sum(len(v) for v in student_ids_by_class.values())
    print(f"  students {total_students}")

    # 7. Exam subjects (6 subjects per class)
    exam_sub_ids: dict[tuple, object] = {}
    for cname in CLASS_NAMES:
        cid = class_ids[cname]
        for order, subj in enumerate(SUBJECTS[:6], 1):
            code = subj[:3].upper()
            esid = await conn.fetchval(
                """
                INSERT INTO exam_subjects
                    (tenant_id,academic_year_id,class_id,name,subject_code,sort_order)
                VALUES ($1,$2,$3,$4,$5,$6)
                ON CONFLICT (tenant_id,academic_year_id,class_id,name) DO NOTHING
                RETURNING id
                """,
                tid, ay_id, cid, subj, code, order,
            )
            if not esid:
                r = await conn.fetchrow(
                    "SELECT id FROM exam_subjects WHERE tenant_id=$1 AND academic_year_id=$2 AND class_id=$3 AND name=$4",
                    tid, ay_id, cid, subj,
                )
                esid = r["id"] if r else None
            if esid:
                exam_sub_ids[(cname, subj)] = esid

    # 8. Exam terms
    terms = [
        ("Term 1",  "term",  "2025-07-01", "2025-07-07",  True,  0),
        ("Term 2",  "term",  "2025-09-15", "2025-09-25",  True,  1),
        ("Term 3",  "term",  "2025-11-01", "2025-11-07",  False, 2),
    ]
    term_ids = {}
    for t_name, t_type, t_start, t_end, t_pub, t_sort in terms:
        tid2 = await conn.fetchval(
            """
            INSERT INTO exam_terms
                (tenant_id,academic_year_id,name,term_type,start_date,end_date,is_published,sort_order)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            ON CONFLICT (tenant_id,academic_year_id,name) DO NOTHING
            RETURNING id
            """,
            tid, ay_id, t_name, t_type,
            date.fromisoformat(t_start), date.fromisoformat(t_end),
            t_pub, t_sort,
        )
        if not tid2:
            r = await conn.fetchrow(
                "SELECT id FROM exam_terms WHERE tenant_id=$1 AND academic_year_id=$2 AND name=$3",
                tid, ay_id, t_name,
            )
            tid2 = r["id"] if r else None
        if tid2:
            term_ids[t_name] = tid2

    # 9. Marks config + mark entries (Term 1 & Term 2, Grade 9)
    t1_id   = term_ids.get("Term 1")
    t2_id   = term_ids.get("Term 2")
    g9_cid  = class_ids.get("Grade 9")
    g9_sids = student_ids_by_class.get("Grade 9", [])
    admin_uid = await conn.fetchval("SELECT id FROM users WHERE tenant_id=$1 AND role='principal'", tid)

    for t_id, max_m, pass_m in [(t1_id, 100, 33), (t2_id, 100, 33)]:
        if not t_id or not g9_cid:
            continue
        for subj in SUBJECTS[:6]:
            esid = exam_sub_ids.get(("Grade 9", subj))
            if not esid:
                continue
            # Marks config
            await conn.execute(
                """
                INSERT INTO exam_marks_config
                    (tenant_id,exam_term_id,exam_subject_id,max_marks,passing_marks)
                VALUES ($1,$2,$3,$4,$5)
                ON CONFLICT (tenant_id,exam_term_id,exam_subject_id) DO NOTHING
                """,
                tid, t_id, esid, max_m, pass_m,
            )
            # Mark entries
            for st_id in g9_sids:
                marks = float(random.randint(int(pass_m * 0.8), max_m))
                await conn.execute(
                    """
                    INSERT INTO mark_entries
                        (tenant_id,student_id,exam_term_id,exam_subject_id,
                         marks_obtained,is_absent,entered_by)
                    VALUES ($1,$2,$3,$4,$5,FALSE,$6)
                    ON CONFLICT (tenant_id,student_id,exam_term_id,exam_subject_id) DO NOTHING
                    """,
                    tid, st_id, t_id, esid, marks, admin_uid,
                )

    # 10. Timetable (Grade 9 A, Mon–Fri)
    from datetime import time as dtime
    def _t(s):
        h, m = s.split(":")
        return dtime(int(h), int(m))

    days_subjs = [
        (1, 1, SUBJECTS[0], "08:00", "08:45"),
        (1, 2, SUBJECTS[1], "08:45", "09:30"),
        (2, 1, SUBJECTS[2], "08:00", "08:45"),
        (2, 2, SUBJECTS[3], "08:45", "09:30"),
        (3, 1, SUBJECTS[4], "08:00", "08:45"),
        (4, 1, SUBJECTS[0], "08:00", "08:45"),
        (5, 1, SUBJECTS[1], "08:00", "08:45"),
    ]
    if g9_cid:
        g9_sec = section_ids.get("Grade 9")
        stf_id = staff_ids[0] if staff_ids else None
        for day, period, subj, st_t, en_t in days_subjs:
            await conn.execute(
                """
                INSERT INTO timetable_slots
                    (tenant_id,academic_year_id,class_id,section_id,
                     day_of_week,period_number,start_time,end_time,subject,staff_id)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                ON CONFLICT (tenant_id,academic_year_id,class_id,section_id,day_of_week,period_number)
                DO NOTHING
                """,
                tid, ay_id, g9_cid, g9_sec, day, period, _t(st_t), _t(en_t), subj, stf_id,
            )

    # 11. Homework posts (5 per school, Grade 9 A)
    if g9_cid:
        g9_sec = section_ids.get("Grade 9")
        for i, (subj, ptype, title, desc) in enumerate(HW_POSTS):
            due = (date.today() + timedelta(days=3 + i * 2)) if ptype == "homework" else None
            await conn.execute(
                """
                INSERT INTO homework_posts
                    (tenant_id,academic_year_id,class_id,section_id,
                     subject,post_type,title,description,due_date,attachment_urls)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'[]')
                ON CONFLICT DO NOTHING
                """,
                tid, ay_id, g9_cid, g9_sec, subj, ptype, title, desc, due,
            )

    # 12. Fee heads + ledger (monthly tuition, April–June)
    fh_id = await conn.fetchval(
        """
        INSERT INTO fee_heads (tenant_id, name, fee_type, sort_order)
        VALUES ($1,'Tuition Fee','monthly',1)
        ON CONFLICT DO NOTHING
        RETURNING id
        """,
        tid,
    )
    if not fh_id:
        fh_id = await conn.fetchval(
            "SELECT id FROM fee_heads WHERE tenant_id=$1 AND name='Tuition Fee'", tid
        )

    if fh_id and g9_cid:
        g9_sids_curr = student_ids_by_class.get("Grade 9", [])
        for st_id in g9_sids_curr:
            for month, year, paid in [(4,2025,True),(5,2025,True),(6,2025,False)]:
                status = "paid" if paid else "pending"
                ledger_id = await conn.fetchval(
                    """
                    INSERT INTO fee_ledger
                        (tenant_id,student_id,fee_head_id,academic_year_id,
                         period_month,period_year,amount_due,status)
                    VALUES ($1,$2,$3,$4,$5,$6,1200,$7)
                    ON CONFLICT DO NOTHING
                    RETURNING id
                    """,
                    tid, st_id, fh_id, ay_id, month, year, status,
                )
                # A 'paid' ledger row must always have a real fee_payments/fee_payment_items
                # row behind it — money_reconciliation()'s orphan_paid check enforces this in
                # prod, and seed data must satisfy the same invariant or it trips daily.
                if paid and ledger_id:
                    await _seed_paid_payment(conn, tid, slug, name, st_id, ledger_id, month, year, "Tuition Fee")

    # 13. CMS page + announcement
    await conn.execute(
        """
        INSERT INTO cms_pages (tenant_id,slug,title,content_html,is_published,sort_order)
        VALUES ($1,'about','About Us',
        $2,
        TRUE, 1)
        ON CONFLICT DO NOTHING
        """,
        tid,
        f"<h2>Welcome to {name}</h2><p>Located in {city}, {name} is committed to quality education and holistic development of students.</p>",
    )
    await conn.execute(
        """
        INSERT INTO cms_announcements (tenant_id,title,body,is_published,published_at)
        VALUES ($1,'Welcome to 2025-2026 Academic Year',
        'We warmly welcome all students and parents to the new academic year. Classes begin on 1st April.',
        TRUE, NOW())
        ON CONFLICT DO NOTHING
        """,
        tid,
    )

    print(f"  ✓ seeded successfully")
    print(f"  login: https://{slug}.tulipsedu.in  |  phone: {school['admin_phone']}  |  pass: {school['admin_password']}")


# ── Main ─────────────────────────────────────────────────────────────────────

async def main() -> None:
    dsn = os.environ.get("DATABASE_URL", "postgresql://tulips:tulips@localhost:5432/tulipsedu")
    conn = await asyncpg.connect(dsn)
    random.seed(42)

    for school in SCHOOLS:
        async with conn.transaction():
            await seed_school(conn, school)

    await conn.close()
    print("\n\nAll schools seeded.")
    print("\n── Superadmin ──────────────────────────────────────────")
    print("  DATABASE_URL=... python scripts/seed_platform.py 9000000000 superadmin123")
    print("  Login: X-Tenant-Slug: platform  |  phone: 9000000000  |  pass: superadmin123")


if __name__ == "__main__":
    asyncio.run(main())
