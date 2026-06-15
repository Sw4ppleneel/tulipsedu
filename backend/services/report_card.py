"""Report-card PDF context — assembles a single student's term result into the
dict the PDF renderer needs. Reuses services.exam.compute_term_results (the same
computation the on-screen grade sheet uses), so the PDF can never drift from the UI.
"""

import uuid
from typing import Optional

import asyncpg

from services.exam import ExamError, compute_term_results


async def build_report_card_context(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    exam_term_id: uuid.UUID,
    student_id: uuid.UUID,
    require_published: bool = False,
) -> Optional[dict]:
    """Returns the report-card context, or None if the student/term/marks aren't
    available. When require_published is True (parent path), an unpublished term
    yields None so parents only ever see released results."""
    info = await conn.fetchrow(
        """
        SELECT s.class_id, s.section_id, s.roll_number, s.admission_no,
               s.first_name || ' ' || s.last_name AS student_name,
               c.name AS class_name, sec.name AS section_name,
               t.name AS school_name,
               et.name AS term_name, et.is_published
        FROM students s
        JOIN classes c     ON c.id = s.class_id
        JOIN sections sec  ON sec.id = s.section_id
        JOIN tenants t     ON t.id = s.tenant_id
        JOIN exam_terms et ON et.id = $3 AND et.tenant_id = s.tenant_id
        WHERE s.id = $1 AND s.tenant_id = $2
        """,
        student_id, tenant_id, exam_term_id,
    )
    if not info:
        return None
    if require_published and not info["is_published"]:
        return None

    try:
        sheet = await compute_term_results(
            conn, tenant_id, exam_term_id, info["class_id"], info["section_id"]
        )
    except ExamError:
        return None

    me = next((r for r in sheet.results if r.student_id == student_id), None)
    if me is None:
        return None

    return {
        "school_name": info["school_name"],
        "term_name": info["term_name"],
        "class_name": info["class_name"],
        "section_name": info["section_name"],
        "student_name": me.student_name,
        "roll_number": me.roll_number,
        "admission_no": me.admission_no,
        "published": info["is_published"],
        "subjects": [
            {
                "name": s.subject_name,
                "max_marks": float(s.max_marks),
                "marks_obtained": float(s.marks_obtained) if s.marks_obtained is not None else None,
                "is_absent": s.is_absent,
                "grade": s.grade,
                "passed": s.passed,
            }
            for s in me.subjects
        ],
        "total_obtained": float(me.total_obtained),
        "total_max": float(me.total_max),
        "percentage": me.percentage,
        "grade": me.grade,
        "passed": me.passed,
    }
