import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import asyncpg

from core.events import emit
from core.security import create_access_token, create_refresh_token, hash_password, verify_password
from models.parent import (
    AttendanceSummary,
    FeeAssignment,
    FeeLedgerEntry,
    FeeSummary,
    HomeworkItem,
    LinkedStudent,
    RecentPayment,
    StudentSummary,
)

logger = logging.getLogger(__name__)

_OTP_TTL_MINUTES = 10


class ParentAuthError(Exception):
    pass


# Bulk-import rows with no phone on record get this placeholder — it must never
# become a usable password source (last 4 would be "0000" for all of them).
PLACEHOLDER_PHONE = "0000000000"

MIN_PORTAL_PASSWORD_LEN = 4  # the derived default (last 4 of phone) is 4 chars


def _default_password_for(parent_phone: str | None) -> str | None:
    """The derived default password: last 4 digits of the registered phone.
    None when the phone can't back a password (missing/placeholder/malformed)."""
    phone = (parent_phone or "").strip()
    if len(phone) != 10 or not phone.isdigit() or phone == PLACEHOLDER_PHONE:
        return None
    return phone[-4:]


def _verify_portal_password(
    supplied: str, password_hash: str | None, parent_phone: str | None
) -> None:
    """Raise ParentAuthError unless `supplied` matches the student's portal
    password: the stored hash if one is set, otherwise the derived default."""
    if password_hash:
        if not verify_password(supplied, password_hash):
            raise ParentAuthError("Incorrect password")
        return
    default = _default_password_for(parent_phone)
    if default is None:
        raise ParentAuthError(
            "No password can be set up for this account yet — "
            "ask the school to update your registered mobile number"
        )
    if supplied != default:
        raise ParentAuthError("Incorrect password")


async def login_by_admission_no(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    tenant_slug: str,
    admission_no: str,
    password: str | None = None,
    require_password: bool = False,
) -> dict:
    """Phase 1 parent auth: log in with the student's permanent admission number.
    The JWT is scoped to that single student (sub = student_id, role = parent).

    When require_password is on (tenant feature_flags.parent_password), the
    caller must also supply the portal password — the stored per-student hash,
    or, while none is set, the last 4 digits of the registered parent phone."""
    student = await conn.fetchrow(
        """
        SELECT id, first_name, last_name, parent_phone, portal_password_hash
        FROM students
        WHERE tenant_id = $1 AND admission_no = $2 AND is_active = TRUE
        """,
        tenant_id, admission_no.strip(),
    )
    if not student:
        raise ParentAuthError("Admission number not found")

    if require_password:
        supplied = (password or "").strip()
        if not supplied:
            raise ParentAuthError("Password required")
        _verify_portal_password(
            supplied, student["portal_password_hash"], student["parent_phone"]
        )

    token_data = {
        "sub": str(student["id"]),
        "tenant_id": str(tenant_id),
        "tenant_slug": tenant_slug,
        "role": "parent",
    }
    await emit(conn, "PARENT_LOGIN", tenant_id, {"student_id": str(student["id"])})

    return {
        "access_token": create_access_token(token_data),
        "refresh_token": create_refresh_token(token_data),
        "student_id": student["id"],
        "student_name": f"{student['first_name']} {student['last_name']}",
    }


async def change_portal_password(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    student_id: uuid.UUID,
    current_password: str,
    new_password: str,
) -> None:
    """Parent self-service password change (parent-portal session, scoped to one
    student). Verifies the current password first — the stored hash, or the
    derived last-4-of-phone default while no hash is set."""
    row = await conn.fetchrow(
        """
        SELECT parent_phone, portal_password_hash
        FROM students
        WHERE id = $1 AND tenant_id = $2 AND is_active = TRUE
        """,
        student_id, tenant_id,
    )
    if not row:
        raise ParentAuthError("Student not found")

    _verify_portal_password(
        (current_password or "").strip(), row["portal_password_hash"], row["parent_phone"]
    )

    new_password = (new_password or "").strip()
    if len(new_password) < MIN_PORTAL_PASSWORD_LEN:
        raise ParentAuthError(
            f"New password must be at least {MIN_PORTAL_PASSWORD_LEN} characters"
        )

    await conn.execute(
        "UPDATE students SET portal_password_hash = $1 WHERE id = $2 AND tenant_id = $3",
        hash_password(new_password), student_id, tenant_id,
    )
    await emit(
        conn, "PARENT_PASSWORD_CHANGED", tenant_id,
        {"student_id": str(student_id), "by": "parent"},
    )


def _generate_otp() -> str:
    return str(secrets.randbelow(900_000) + 100_000)


async def request_otp(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, phone_number: str
) -> str:
    """Create or update parent record, generate OTP. Returns plaintext OTP."""
    otp = _generate_otp()
    otp_hash = hash_password(otp)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=_OTP_TTL_MINUTES)

    # Upsert parent record
    parent = await conn.fetchrow(
        "SELECT id FROM parents WHERE tenant_id = $1 AND phone_number = $2",
        tenant_id, phone_number,
    )

    if parent:
        await conn.execute(
            """
            UPDATE parents
            SET otp_hash = $1, otp_expires_at = $2
            WHERE tenant_id = $3 AND phone_number = $4
            """,
            otp_hash, expires_at, tenant_id, phone_number,
        )
        parent_id = parent["id"]
    else:
        parent_id = await conn.fetchval(
            """
            INSERT INTO parents (tenant_id, phone_number, otp_hash, otp_expires_at)
            VALUES ($1, $2, $3, $4)
            RETURNING id
            """,
            tenant_id, phone_number, otp_hash, expires_at,
        )
        # Auto-link students by parent_phone match
        await conn.execute(
            """
            INSERT INTO parent_students (parent_id, student_id)
            SELECT $1, s.id
            FROM students s
            WHERE s.tenant_id = $2
              AND s.parent_phone = $3
              AND s.is_active = TRUE
            ON CONFLICT DO NOTHING
            """,
            parent_id, tenant_id, phone_number,
        )

    logger.info("OTP requested for parent phone=%s tenant=%s", phone_number, tenant_id)
    return otp


async def verify_otp(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    tenant_slug: str,
    phone_number: str,
    otp: str,
) -> dict:
    row = await conn.fetchrow(
        """
        SELECT id, otp_hash, otp_expires_at, is_active
        FROM parents
        WHERE tenant_id = $1 AND phone_number = $2
        """,
        tenant_id, phone_number,
    )

    if not row:
        raise ParentAuthError("No account found for this phone number")

    if not row["is_active"]:
        raise ParentAuthError("Account is inactive")

    if not row["otp_hash"] or not row["otp_expires_at"]:
        raise ParentAuthError("No OTP pending — request one first")

    if datetime.now(timezone.utc) > row["otp_expires_at"]:
        raise ParentAuthError("OTP has expired")

    if not verify_password(otp, row["otp_hash"]):
        raise ParentAuthError("Invalid OTP")

    parent_id = row["id"]
    now = datetime.now(timezone.utc)

    await conn.execute(
        "UPDATE parents SET otp_hash = NULL, otp_expires_at = NULL, last_login_at = $1 WHERE id = $2",
        now, parent_id,
    )

    await emit(conn, "PARENT_LOGIN", tenant_id, {"parent_id": str(parent_id)})

    token_data = {
        "sub": str(parent_id),
        "tenant_id": str(tenant_id),
        "tenant_slug": tenant_slug,
        "role": "parent",
    }
    return {
        "access_token": create_access_token(token_data),
        "refresh_token": create_refresh_token(token_data),
    }


async def get_linked_students(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, parent_id: uuid.UUID
) -> list[LinkedStudent]:
    rows = await conn.fetch(
        """
        SELECT
            s.id, s.first_name, s.last_name, s.admission_no, s.roll_number,
            s.class_id, s.section_id, s.academic_year_id,
            c.name AS class_name, sec.name AS section_name,
            ps.relationship
        FROM parent_students ps
        JOIN students s ON s.id = ps.student_id
        JOIN classes c ON c.id = s.class_id
        JOIN sections sec ON sec.id = s.section_id
        WHERE ps.parent_id = $1
          AND s.tenant_id = $2
          AND s.is_active = TRUE
        ORDER BY c.numeric_order, sec.name
        """,
        parent_id, tenant_id,
    )
    return [LinkedStudent(**dict(r)) for r in rows]


async def _attendance_summary(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    student_id: uuid.UUID,
    class_id: uuid.UUID,
    section_id: uuid.UUID,
    academic_year_id: uuid.UUID,
) -> AttendanceSummary:
    row = await conn.fetchrow(
        """
        SELECT
            COUNT(ar.id)                                       AS total_sessions,
            COUNT(CASE WHEN ar.status = 'P' THEN 1 END)       AS present,
            COUNT(CASE WHEN ar.status = 'A' THEN 1 END)       AS absent,
            COUNT(CASE WHEN ar.status = 'L' THEN 1 END)       AS late
        FROM attendance_sessions s
        JOIN attendance_records ar
             ON ar.session_id = s.id AND ar.tenant_id = s.tenant_id
        WHERE s.tenant_id = $1
          AND s.academic_year_id = $2
          AND s.class_id = $3
          AND s.section_id = $4
          AND ar.student_id = $5
          AND s.submitted = TRUE
        """,
        tenant_id, academic_year_id, class_id, section_id, student_id,
    )
    total = row["total_sessions"] or 0
    present = row["present"] or 0
    pct = round((present / total * 100), 1) if total else 0.0
    return AttendanceSummary(
        total_sessions=total,
        present=present,
        absent=row["absent"] or 0,
        late=row["late"] or 0,
        percentage=pct,
    )


async def _fee_summary(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, student_id: uuid.UUID
) -> FeeSummary:
    # Aggregate from the fee ledger
    agg = await conn.fetchrow(
        """
        SELECT
            COALESCE(SUM(CASE WHEN status != 'waived' THEN amount_due ELSE 0 END), 0) AS total_due,
            COALESCE(SUM(CASE WHEN status = 'paid'    THEN amount_due ELSE 0 END), 0) AS total_paid,
            COALESCE(SUM(CASE WHEN status IN ('pending', 'due', 'overdue') THEN amount_due ELSE 0 END), 0) AS balance
        FROM fee_ledger
        WHERE tenant_id = $1 AND student_id = $2
        """,
        tenant_id, student_id,
    )
    assignments = [
        FeeAssignment(
            structure_name="School Fees",
            total_amount=float(agg["total_due"]),
            paid_amount=float(agg["total_paid"]),
            balance=float(agg["balance"]),
            status="paid" if float(agg["balance"]) == 0 and float(agg["total_due"]) > 0 else "pending",
        )
    ] if agg and float(agg["total_due"]) > 0 else []

    payment_rows = await conn.fetch(
        """
        SELECT amount, payment_method, payment_ref AS reference_no, paid_at AS created_at
        FROM fee_payments
        WHERE tenant_id = $1 AND student_id = $2 AND status = 'captured'
        ORDER BY paid_at DESC NULLS LAST LIMIT 5
        """,
        tenant_id, student_id,
    )
    recent = [
        RecentPayment(
            amount=float(r["amount"]),
            payment_method=r["payment_method"] or "cash",
            reference_no=r["reference_no"],
            created_at=r["created_at"],
        )
        for r in payment_rows
    ]
    total_balance = float(agg["balance"]) if agg else 0.0
    return FeeSummary(assignments=assignments, recent_payments=recent, total_balance=total_balance)


async def _recent_homework(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    class_id: uuid.UUID,
    section_id: uuid.UUID,
) -> list[HomeworkItem]:
    rows = await conn.fetch(
        """
        SELECT id, subject, post_type, title, description,
               due_date::text AS due_date, created_at,
               COALESCE(attachment_urls, '[]'::jsonb) AS attachment_urls
        FROM homework_posts
        WHERE tenant_id = $1
          AND class_id = $2
          AND section_id = $3
          AND is_active = TRUE
        ORDER BY created_at DESC LIMIT 10
        """,
        tenant_id, class_id, section_id,
    )
    items = []
    for r in rows:
        d = dict(r)
        urls = d.get("attachment_urls") or []
        if isinstance(urls, str):
            import json as _json
            urls = _json.loads(urls)
        d["attachment_urls"] = urls
        items.append(HomeworkItem(**d))
    return items


async def get_student_summary(
    conn: asyncpg.Connection,
    tenant_id: uuid.UUID,
    parent_id: uuid.UUID,
    student_id: uuid.UUID,
) -> StudentSummary | None:
    # Verify parent-student link
    link = await conn.fetchrow(
        """
        SELECT ps.relationship, s.id, s.first_name, s.last_name, s.admission_no,
               s.roll_number, s.class_id, s.section_id, s.academic_year_id,
               c.name AS class_name, sec.name AS section_name
        FROM parent_students ps
        JOIN students s ON s.id = ps.student_id
        JOIN classes c ON c.id = s.class_id
        JOIN sections sec ON sec.id = s.section_id
        WHERE ps.parent_id = $1
          AND ps.student_id = $2
          AND s.tenant_id = $3
          AND s.is_active = TRUE
        """,
        parent_id, student_id, tenant_id,
    )
    if not link:
        return None

    student = LinkedStudent(**dict(link))
    attendance = await _attendance_summary(
        conn, tenant_id, student_id,
        link["class_id"], link["section_id"], link["academic_year_id"],
    )
    fees = await _fee_summary(conn, tenant_id, student_id)
    homework = await _recent_homework(conn, tenant_id, link["class_id"], link["section_id"])

    school = await conn.fetchrow(
        "SELECT name, upi_id FROM tenants WHERE id = $1", tenant_id
    )

    return StudentSummary(
        student=student,
        attendance=attendance,
        fees=fees,
        recent_homework=homework,
        school_name=school["name"] if school else "",
        school_upi_id=school["upi_id"] if school else None,
    )


async def get_student_basic(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, student_id: uuid.UUID
) -> LinkedStudent | None:
    row = await conn.fetchrow(
        """
        SELECT s.id, s.first_name, s.last_name, s.admission_no, s.roll_number,
               s.class_id, s.section_id, s.academic_year_id,
               c.name AS class_name, sec.name AS section_name
        FROM students s
        JOIN classes c ON c.id = s.class_id
        JOIN sections sec ON sec.id = s.section_id
        WHERE s.id = $1 AND s.tenant_id = $2 AND s.is_active = TRUE
        """,
        student_id, tenant_id,
    )
    if not row:
        return None
    return LinkedStudent(**dict(row), relationship="self")


async def get_student_summary_by_id(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, student_id: uuid.UUID
) -> StudentSummary | None:
    """Summary for an admission-number session, scoped directly to one student
    (no parent_students link)."""
    student = await get_student_basic(conn, tenant_id, student_id)
    if not student:
        return None

    attendance = await _attendance_summary(
        conn, tenant_id, student_id,
        student.class_id, student.section_id, student.academic_year_id,
    )
    fees = await _fee_summary(conn, tenant_id, student_id)
    homework = await _recent_homework(conn, tenant_id, student.class_id, student.section_id)
    school = await conn.fetchrow("SELECT name, upi_id FROM tenants WHERE id = $1", tenant_id)

    return StudentSummary(
        student=student,
        attendance=attendance,
        fees=fees,
        recent_homework=homework,
        school_name=school["name"] if school else "",
        school_upi_id=school["upi_id"] if school else None,
    )


async def get_fee_ledger_entries(
    conn: asyncpg.Connection, tenant_id: uuid.UUID, student_id: uuid.UUID
) -> list[FeeLedgerEntry]:
    rows = await conn.fetch(
        """
        SELECT fl.id, fh.name AS fee_head_name,
               fl.period_month, fl.period_year,
               fl.amount_due, fl.status
        FROM fee_ledger fl
        JOIN fee_heads fh ON fh.id = fl.fee_head_id
        WHERE fl.tenant_id = $1 AND fl.student_id = $2
        ORDER BY fl.period_year, fl.period_month NULLS FIRST, fh.name
        """,
        tenant_id, student_id,
    )
    return [
        FeeLedgerEntry(
            id=r["id"],
            fee_head_name=r["fee_head_name"],
            period_month=r["period_month"],
            period_year=r["period_year"],
            amount_due=float(r["amount_due"]),
            status=r["status"],
        )
        for r in rows
    ]
