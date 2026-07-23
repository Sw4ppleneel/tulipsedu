"""Principal-facing view over audit_events: accountability for every
state-changing action a staff member takes, not just the fee/student
subset originally built. audit_events itself stays the immutable, generic
append-only log (Security Rules); this is a read-only, human-readable
projection that resolves the actor and subject (student or staff) UUIDs
embedded in each event's payload into names.

Adding a new event type here is a three-line addition to _EVENTS below —
actor_keys (checked in order; some events have different keys depending on
which code path emitted them), subject_key (student_id/staff_id/None for
events with no single subject, e.g. a bulk import or a class-wide post),
and a summary function.
"""
import json
import uuid

import asyncpg

from models.activity_log import ActivityLogEntry


def _fields(p):
    return ", ".join(p.get("fields", []))


_EVENTS: dict[str, dict] = {
    # ── Students ──────────────────────────────────────────────────────────
    "STUDENT_CREATED":       {"actor_keys": ["created_by"], "subject_key": "student_id",
                               "summary": lambda p: f"Created (admission no. {p.get('admission_no', '?')})"},
    "STUDENT_UPDATED":       {"actor_keys": ["updated_by"], "subject_key": "student_id",
                               "summary": lambda p: f"Edited: {_fields(p)}"},
    "STUDENT_DEACTIVATED":   {"actor_keys": ["deactivated_by"], "subject_key": "student_id",
                               "summary": lambda p: "Deactivated"},
    "STUDENTS_IMPORTED":     {"actor_keys": ["imported_by"], "subject_key": None,
                               "summary": lambda p: f"Bulk import: {p.get('created', 0)} created, {p.get('updated', 0)} updated, {p.get('error_count', 0)} errors"},
    "PARENT_PASSWORD_CHANGED": {"actor_keys": ["reset_by"], "subject_key": "student_id",
                                 "summary": lambda p: f"Parent-portal password reset (by {p.get('by', '?')}{', role ' + p['role'] if p.get('role') else ''})"},
    # ── Fees / concessions ───────────────────────────────────────────────
    "FEE_WAIVED":            {"actor_keys": ["waived_by"], "subject_key": "student_id",
                               "summary": lambda p: f"Waived ₹{p.get('total', '?')} — {p.get('reason', '')}"},
    "STUDENT_DISCOUNT_SET":  {"actor_keys": ["set_by"], "subject_key": "student_id",
                               "summary": lambda p: (
                                   f"Cleared discounts ({p.get('rows_updated', 0)} rows restored)"
                                   if not p.get("discounts")
                                   else f"Set discount ({len(p.get('discounts', []))} fee head(s), {p.get('rows_updated', 0)} rows updated)"
                               )},
    "FEE_PAID":               {"actor_keys": ["collected_by"], "subject_key": "student_id",
                                "summary": lambda p: f"Collected ₹{p.get('amount', '?')} — receipt {p.get('receipt_number', '?')}"},
    "FEE_PAYMENT_REJECTED":   {"actor_keys": ["rejected_by"], "subject_key": "student_id",
                                "summary": lambda p: f"Rejected payment claim — {p.get('reason', '')}"},
    "FEE_HEAD_CREATED":       {"actor_keys": ["created_by"], "subject_key": None,
                                "summary": lambda p: f"Fee head created: {p.get('name', '?')} ({p.get('fee_type', '?')})"},
    "FEE_HEAD_TOGGLED":       {"actor_keys": ["toggled_by"], "subject_key": None,
                                "summary": lambda p: f"Fee head {'activated' if p.get('is_active') else 'deactivated'}"},
    "FEE_SCHEDULE_SET":       {"actor_keys": ["set_by"], "subject_key": None,
                                "summary": lambda p: f"Fee schedule set: ₹{p.get('amount', '?')}" + (f" (class-specific)" if p.get("class_id") else " (all classes)")},
    "FEE_STRUCTURE_IMPORTED": {"actor_keys": ["imported_by"], "subject_key": None,
                                "summary": lambda p: f"Fee structure imported: {p.get('fee_heads_created', 0)} heads, {p.get('schedules_created', 0)} schedules created"},
    "REMINDER_SENT":          {"actor_keys": ["sent_by"], "subject_key": "student_id",
                                "summary": lambda p: "Fee reminder sent"},
    # ── Homework ──────────────────────────────────────────────────────────
    "HOMEWORK_ASSIGNED": {"actor_keys": ["posted_by"], "subject_key": None,
                           "summary": lambda p: f"Posted {p.get('post_type', 'homework')}"},
    "HOMEWORK_UPDATED":  {"actor_keys": ["updated_by"], "subject_key": None,
                           "summary": lambda p: f"Edited post: {_fields(p)}"},
    "HOMEWORK_DELETED":  {"actor_keys": ["deleted_by"], "subject_key": None,
                           "summary": lambda p: "Deleted post"},
    # ── Attendance ────────────────────────────────────────────────────────
    "ATTENDANCE_MARKED":    {"actor_keys": ["marked_by"], "subject_key": None,
                              "summary": lambda p: f"Marked attendance ({p.get('count', '?')} students)"},
    "ATTENDANCE_CORRECTED": {"actor_keys": ["marked_by"], "subject_key": None,
                              "summary": lambda p: f"Corrected attendance ({p.get('count', '?')} students)"},
    "ATTENDANCE_OVERRIDE":  {"actor_keys": ["marked_by"], "subject_key": None,
                              "summary": lambda p: f"Overrode locked attendance ({p.get('count', '?')} students)"},
    "ATTENDANCE_SESSION_SUBMITTED": {"actor_keys": ["submitted_by"], "subject_key": None,
                                      "summary": lambda p: "Submitted attendance session"},
    # ── Exams ─────────────────────────────────────────────────────────────
    "EXAM_PUBLISHED":     {"actor_keys": ["changed_by"], "subject_key": None,
                            "summary": lambda p: "Published exam term results"},
    "EXAM_MARKS_OPENED":  {"actor_keys": ["changed_by"], "subject_key": None,
                            "summary": lambda p: "Opened marks entry"},
    "EXAM_MARKS_LOCKED":  {"actor_keys": ["changed_by"], "subject_key": None,
                            "summary": lambda p: "Locked marks entry"},
    "EXAM_REOPENED":      {"actor_keys": ["changed_by"], "subject_key": None,
                            "summary": lambda p: f"Reopened term ({p.get('from_status', '?')} → {p.get('to_status', '?')})"},
    "EXAM_COMPONENTS_CONFIGURED": {"actor_keys": ["configured_by"], "subject_key": None,
                                    "summary": lambda p: f"Configured {p.get('component_count', '?')} mark component(s)"},
    "MARKS_ENTERED":      {"actor_keys": ["entered_by"], "subject_key": None,
                            "summary": lambda p: f"Entered marks ({p.get('count', '?')} students)"},
    # ── Staff ─────────────────────────────────────────────────────────────
    "STAFF_CREATED":            {"actor_keys": ["created_by"], "subject_key": "staff_id",
                                  "summary": lambda p: f"Staff created (employee no. {p.get('employee_no', '?')})"},
    "STAFF_UPDATED":            {"actor_keys": ["updated_by"], "subject_key": "staff_id",
                                  "summary": lambda p: f"Staff record edited: {_fields(p)}"},
    "STAFF_DEACTIVATED":        {"actor_keys": ["deactivated_by"], "subject_key": "staff_id",
                                  "summary": lambda p: "Staff deactivated"},
    "STAFF_IMPORTED":           {"actor_keys": ["imported_by"], "subject_key": None,
                                  "summary": lambda p: f"Bulk staff import: {p.get('created', 0)} created, {p.get('updated', 0)} updated"},
    "STAFF_ROLE_ASSIGNED":      {"actor_keys": ["assigned_by"], "subject_key": "staff_id",
                                  "summary": lambda p: f"Roles set: {', '.join(p.get('roles', []))}" + (" (login created)" if p.get("login_created") else "")},
    "STAFF_ASSIGNED":           {"actor_keys": ["assigned_by"], "subject_key": "staff_id",
                                  "summary": lambda p: "Assigned to a class/section"},
    "STAFF_ASSIGNMENT_REMOVED": {"actor_keys": ["removed_by"], "subject_key": "staff_id",
                                  "summary": lambda p: "Class assignment removed"},
    "PASSWORD_CHANGED":         {"actor_keys": ["reset_by", "user_id"], "subject_key": "staff_id",
                                  "summary": lambda p: f"Password changed (by {p.get('by', '?')})"},
    # ── Payroll ───────────────────────────────────────────────────────────
    "SALARY_STRUCTURE_SET": {"actor_keys": ["set_by"], "subject_key": "staff_id",
                              "summary": lambda p: f"Salary set: ₹{p.get('gross_salary', '?')} gross"},
    "PAYROLL_RUN_CREATED":  {"actor_keys": ["created_by"], "subject_key": None,
                              "summary": lambda p: f"Payroll run created ({p.get('period', '?')}, {p.get('payslips', '?')} payslips)"},
    "PAYROLL_FINALIZED":    {"actor_keys": ["finalized_by"], "subject_key": None,
                              "summary": lambda p: "Payroll run finalized (locked)"},
    "PAYSLIP_UPDATED":      {"actor_keys": ["updated_by"], "subject_key": None,
                              "summary": lambda p: f"Payslip adjusted — net ₹{p.get('net_salary', '?')}"},
    # ── Admissions ────────────────────────────────────────────────────────
    "ADMISSION_STATUS_CHANGED": {"actor_keys": ["changed_by"], "subject_key": None,
                                  "summary": lambda p: f"Admission {p.get('from_status', '?')} → {p.get('to_status', '?')}"},
    "ADMISSION_APPROVED":       {"actor_keys": ["enrolled_by"], "subject_key": None,
                                  "summary": lambda p: "Admission approved and enrolled"},
    # ── Academic year ─────────────────────────────────────────────────────
    "ACADEMIC_YEAR_ROLLED_OVER": {"actor_keys": ["initiated_by"], "subject_key": None,
                                   "summary": lambda p: "Academic year rolled over"},
}


# Groups events for the frontend's category filter — purely a UI convenience,
# doesn't affect what's stored or how an individual event resolves.
CATEGORIES: dict[str, list[str]] = {
    "students": ["STUDENT_CREATED", "STUDENT_UPDATED", "STUDENT_DEACTIVATED", "STUDENTS_IMPORTED", "PARENT_PASSWORD_CHANGED"],
    "fees": ["FEE_WAIVED", "STUDENT_DISCOUNT_SET", "FEE_PAID", "FEE_PAYMENT_REJECTED", "FEE_HEAD_CREATED", "FEE_HEAD_TOGGLED", "FEE_SCHEDULE_SET", "FEE_STRUCTURE_IMPORTED", "REMINDER_SENT"],
    "homework": ["HOMEWORK_ASSIGNED", "HOMEWORK_UPDATED", "HOMEWORK_DELETED"],
    "attendance": ["ATTENDANCE_MARKED", "ATTENDANCE_CORRECTED", "ATTENDANCE_OVERRIDE", "ATTENDANCE_SESSION_SUBMITTED"],
    "exams": ["EXAM_PUBLISHED", "EXAM_MARKS_OPENED", "EXAM_MARKS_LOCKED", "EXAM_REOPENED", "EXAM_COMPONENTS_CONFIGURED", "MARKS_ENTERED"],
    "staff": ["STAFF_CREATED", "STAFF_UPDATED", "STAFF_DEACTIVATED", "STAFF_IMPORTED", "STAFF_ROLE_ASSIGNED", "STAFF_ASSIGNED", "STAFF_ASSIGNMENT_REMOVED", "PASSWORD_CHANGED"],
    "payroll": ["SALARY_STRUCTURE_SET", "PAYROLL_RUN_CREATED", "PAYROLL_FINALIZED", "PAYSLIP_UPDATED"],
    "admissions": ["ADMISSION_STATUS_CHANGED", "ADMISSION_APPROVED"],
    "academic": ["ACADEMIC_YEAR_ROLLED_OVER"],
}

_EVENT_TO_CATEGORY: dict[str, str] = {
    event: cat for cat, events in CATEGORIES.items() for event in events
}


async def list_activity(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, limit: int = 100, offset: int = 0,
    event_types: list[str] | None = None,
) -> list[ActivityLogEntry]:
    types = event_types or list(_EVENTS.keys())
    rows = await conn.fetch(
        """
        SELECT id, event_type, payload, created_at
        FROM audit_events
        WHERE tenant_id = $1 AND event_type = ANY($2::text[])
        ORDER BY created_at DESC
        LIMIT $3 OFFSET $4
        """,
        tenant_id, types, limit, offset,
    )
    if not rows:
        return []

    parsed = []
    student_ids: set[uuid.UUID] = set()
    staff_ids: set[uuid.UUID] = set()
    actor_ids: set[uuid.UUID] = set()

    def _try_uuid(raw):
        if not raw:
            return None
        try:
            return uuid.UUID(raw)
        except (ValueError, TypeError):
            return None

    for r in rows:
        payload = json.loads(r["payload"]) if isinstance(r["payload"], str) else r["payload"]
        spec = _EVENTS.get(r["event_type"], {})
        parsed.append((r["id"], r["event_type"], payload, r["created_at"]))

        subject_key = spec.get("subject_key")
        if subject_key:
            sid = _try_uuid(payload.get(subject_key))
            if sid:
                (student_ids if subject_key == "student_id" else staff_ids).add(sid)

        for key in spec.get("actor_keys", []):
            aid = _try_uuid(payload.get(key))
            if aid:
                actor_ids.add(aid)
                break

    student_names: dict[str, str] = {}
    if student_ids:
        srows = await conn.fetch(
            "SELECT id, first_name, last_name, admission_no FROM students WHERE tenant_id = $1 AND id = ANY($2::uuid[])",
            tenant_id, list(student_ids),
        )
        student_names = {
            str(s["id"]): f"{s['first_name']} {s['last_name']} ({s['admission_no']})" for s in srows
        }

    staff_names: dict[str, str] = {}
    if staff_ids:
        strows = await conn.fetch(
            "SELECT id, first_name, last_name, employee_no FROM staff WHERE tenant_id = $1 AND id = ANY($2::uuid[])",
            tenant_id, list(staff_ids),
        )
        staff_names = {
            str(s["id"]): f"{s['first_name']} {s['last_name']} ({s['employee_no']})" for s in strows
        }

    actor_names: dict[str, str] = {}
    if actor_ids:
        arows = await conn.fetch(
            """
            SELECT u.id, s.first_name, s.last_name, u.role
            FROM users u LEFT JOIN staff s ON s.user_id = u.id AND s.tenant_id = u.tenant_id
            WHERE u.tenant_id = $1 AND u.id = ANY($2::uuid[])
            """,
            tenant_id, list(actor_ids),
        )
        actor_names = {
            str(a["id"]): (f"{a['first_name']} {a['last_name']}" if a["first_name"] else a["role"])
            for a in arows
        }

    entries = []
    for eid, event_type, payload, created_at in parsed:
        spec = _EVENTS.get(event_type, {})
        subject_key = spec.get("subject_key")
        subject_name = None
        if subject_key == "student_id":
            subject_name = student_names.get(payload.get("student_id"))
        elif subject_key == "staff_id":
            subject_name = staff_names.get(payload.get("staff_id"))

        actor_raw = None
        for key in spec.get("actor_keys", []):
            if payload.get(key):
                actor_raw = payload[key]
                break
        actor_name = actor_names.get(actor_raw, actor_raw or "unknown")

        summary_fn = spec.get("summary")
        summary = summary_fn(payload) if summary_fn else event_type

        entries.append(ActivityLogEntry(
            id=eid, event_type=event_type, category=_EVENT_TO_CATEGORY.get(event_type, "other"),
            created_at=created_at,
            subject_name=subject_name, actor_name=actor_name, summary=summary,
        ))
    return entries
