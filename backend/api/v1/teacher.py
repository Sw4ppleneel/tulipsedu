"""Teacher portal backend.

A teacher's view is strictly scoped to assigned (class, section) pairs
(load_class_scope → request.state.class_scope). The dashboard surfaces the
day's work: assigned classes with today's attendance status, which classes
still need attendance, recent homework/notices in those classes, and upcoming
exams. Admin-tier roles have their own /dashboard; this router is teacher-only.
"""

from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Request

from core.rbac import load_class_scope, require_roles

router = APIRouter(
    prefix="/teacher",
    tags=["Teacher"],
    dependencies=[
        Depends(require_roles("teacher", "class_teacher")),
        Depends(load_class_scope),
    ],
)

_IST = ZoneInfo("Asia/Kolkata")


@router.get("/dashboard")
async def teacher_dashboard(request: Request):
    tid = request.state.tenant_id
    scope = getattr(request.state, "class_scope", None) or set()
    today = datetime.now(_IST).date()

    empty = {
        "today": str(today), "classes": [], "pending_attendance": [],
        "recent_homework": [], "recent_notices": [], "upcoming_exams": [],
    }
    if not scope:
        return empty

    # Positional pair arrays for exact (class, section) matching via unnest.
    class_ids = [c for (c, s) in scope]
    section_ids = [s for (c, s) in scope]
    staff_id = getattr(request.state, "staff_id", None)

    pool = request.app.state.pool
    async with pool.acquire() as conn:
        # Assigned classes + today's attendance status.
        class_rows = await conn.fetch(
            """
            SELECT sca.class_id, sca.section_id, c.name AS class_name,
                   sec.name AS section_name, sca.subject, sca.is_class_teacher,
                   sess.id IS NOT NULL          AS has_session,
                   COALESCE(sess.submitted, FALSE) AS submitted
            FROM staff_class_assignments sca
            JOIN classes  c   ON c.id   = sca.class_id
            JOIN sections sec ON sec.id = sca.section_id
            LEFT JOIN attendance_sessions sess
              ON sess.tenant_id = sca.tenant_id AND sess.class_id = sca.class_id
             AND sess.section_id = sca.section_id AND sess.date = $3
            WHERE sca.tenant_id = $1 AND sca.staff_id = $2
            ORDER BY c.name, sec.name
            """,
            tid, staff_id, today,
        )

        recent_homework = await conn.fetch(
            """
            SELECT hp.id, hp.title, hp.subject, hp.post_type, hp.due_date, hp.created_at,
                   c.name AS class_name, sec.name AS section_name
            FROM homework_posts hp
            JOIN classes  c   ON c.id   = hp.class_id
            JOIN sections sec ON sec.id = hp.section_id
            WHERE hp.tenant_id = $1 AND hp.is_active = TRUE AND hp.post_type = 'homework'
              AND (hp.class_id, hp.section_id) IN (SELECT * FROM unnest($2::uuid[], $3::uuid[]))
            ORDER BY hp.created_at DESC LIMIT 6
            """,
            tid, class_ids, section_ids,
        )

        # Notices: classroom announcements in scope + institution-wide CMS notices.
        class_notices = await conn.fetch(
            """
            SELECT hp.id, hp.title, hp.created_at, c.name AS class_name, sec.name AS section_name
            FROM homework_posts hp
            JOIN classes  c   ON c.id   = hp.class_id
            JOIN sections sec ON sec.id = hp.section_id
            WHERE hp.tenant_id = $1 AND hp.is_active = TRUE AND hp.post_type = 'announcement'
              AND (hp.class_id, hp.section_id) IN (SELECT * FROM unnest($2::uuid[], $3::uuid[]))
            ORDER BY hp.created_at DESC LIMIT 5
            """,
            tid, class_ids, section_ids,
        )
        inst_notices = await conn.fetch(
            """
            SELECT id, title, COALESCE(published_at, created_at) AS created_at
            FROM cms_announcements
            WHERE tenant_id = $1 AND is_published = TRUE
              AND (expires_at IS NULL OR expires_at > NOW())
            ORDER BY COALESCE(published_at, created_at) DESC LIMIT 5
            """,
            tid,
        )

        upcoming_exams = await conn.fetch(
            """
            SELECT et.id, et.name, et.term_type, et.start_date, et.end_date
            FROM exam_terms et
            JOIN academic_years ay ON ay.id = et.academic_year_id AND ay.is_current = TRUE
            WHERE et.tenant_id = $1 AND et.end_date >= $2
            ORDER BY et.start_date LIMIT 5
            """,
            tid, today,
        )

    classes = []
    pending = []
    for r in class_rows:
        status = "submitted" if r["submitted"] else ("draft" if r["has_session"] else "none")
        item = {
            "class_id": str(r["class_id"]), "section_id": str(r["section_id"]),
            "class_name": r["class_name"], "section_name": r["section_name"],
            "subject": r["subject"], "is_class_teacher": r["is_class_teacher"],
            "attendance_today": status,
        }
        classes.append(item)
        if status != "submitted":
            pending.append(item)

    notices = [
        {"id": str(n["id"]), "title": n["title"], "scope": f"{n['class_name']} {n['section_name']}",
         "created_at": n["created_at"]}
        for n in class_notices
    ] + [
        {"id": str(n["id"]), "title": n["title"], "scope": "School-wide", "created_at": n["created_at"]}
        for n in inst_notices
    ]
    notices.sort(key=lambda x: x["created_at"], reverse=True)

    return {
        "today": str(today),
        "classes": classes,
        "pending_attendance": pending,
        "recent_homework": [dict(r) for r in recent_homework],
        "recent_notices": notices[:6],
        "upcoming_exams": [dict(r) for r in upcoming_exams],
    }
