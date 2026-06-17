"""Admissions pipeline — enquiry→application→docs_pending→approved→enrolled/rejected."""

from datetime import date
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from core.events import emit
from core.rbac import require_roles
from services.finance import generate_ledger
from models.finance import GenerateLedgerRequest

router = APIRouter(prefix="/admissions", tags=["admissions"])

_STAFF = Depends(require_roles("principal", "vice_principal"))
_PRINCIPAL = Depends(require_roles("principal"))

VALID_TRANSITIONS: dict[str, list[str]] = {
    "enquiry":     ["application", "rejected"],
    "application": ["docs_pending", "rejected"],
    "docs_pending": ["approved", "rejected"],
    "approved":    ["enrolled", "rejected"],
    "enrolled":    [],
    "rejected":    [],
}


class EnquiryCreate(BaseModel):
    applicant_name: str
    applicant_dob: Optional[date] = None
    applying_class_id: Optional[UUID] = None
    parent_name: Optional[str] = None
    parent_phone: Optional[str] = None
    notes: Optional[str] = None


class StatusAdvance(BaseModel):
    status: str
    reason: Optional[str] = None


class EnrolRequest(BaseModel):
    academic_year_id: UUID
    class_id: UUID
    section_id: UUID
    roll_number: Optional[str] = None
    adm_no: Optional[str] = None


# ── Public enquiry endpoint (no auth) ─────────────────────────────────────────

@router.post("/enquiry", status_code=201)
async def create_enquiry(data: EnquiryCreate, request: Request):
    """Public form submission — no JWT required."""
    pool = request.app.state.pool
    tid = request.state.tenant_id
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO admissions
              (tenant_id, applicant_name, applicant_dob, applying_class_id,
               parent_name, parent_phone, notes, public_enquiry)
            VALUES ($1, $2, $3::date, $4, $5, $6, $7, TRUE)
            RETURNING id, status, applicant_name, created_at
            """,
            tid, data.applicant_name, data.applicant_dob,
            data.applying_class_id, data.parent_name, data.parent_phone,
            data.notes,
        )
        await emit(conn, "ADMISSION_ENQUIRY_RECEIVED", tid, {
            "admission_id": str(row["id"]),
            "applicant_name": data.applicant_name,
        })
    return {"id": str(row["id"]), "status": row["status"], "message": "Enquiry received. We will contact you shortly."}


# ── Staff routes ───────────────────────────────────────────────────────────────

@router.get("", dependencies=[_STAFF])
async def list_admissions(
    request: Request,
    status: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    pool = request.app.state.pool
    tid = request.state.tenant_id
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT a.id, a.status, a.applicant_name, a.applicant_dob,
                   a.parent_name, a.parent_phone, a.notes,
                   a.public_enquiry, a.rejected_reason, a.student_id,
                   a.created_at, a.updated_at,
                   c.name AS class_name
            FROM admissions a
            LEFT JOIN classes c ON c.id = a.applying_class_id
            WHERE a.tenant_id = $1
              AND ($2::text IS NULL OR a.status = $2::text)
            ORDER BY a.created_at DESC
            LIMIT $3 OFFSET $4
            """,
            tid, status, limit, offset,
        )
    return [dict(r) for r in rows]


@router.get("/{admission_id}", dependencies=[_STAFF])
async def get_admission(admission_id: UUID, request: Request):
    pool = request.app.state.pool
    tid = request.state.tenant_id
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT a.*, c.name AS class_name
            FROM admissions a
            LEFT JOIN classes c ON c.id = a.applying_class_id
            WHERE a.id = $1 AND a.tenant_id = $2
            """,
            admission_id, tid,
        )
    if not row:
        raise HTTPException(status_code=404, detail="Admission not found")
    return dict(row)


@router.patch("/{admission_id}/status", dependencies=[_STAFF])
async def advance_status(admission_id: UUID, body: StatusAdvance, request: Request):
    """Move an admission to the next status (or reject it)."""
    pool = request.app.state.pool
    tid = request.state.tenant_id
    async with pool.acquire() as conn:
        current = await conn.fetchrow(
            "SELECT status FROM admissions WHERE id=$1 AND tenant_id=$2 FOR UPDATE",
            admission_id, tid,
        )
        if not current:
            raise HTTPException(status_code=404, detail="Admission not found")
        allowed = VALID_TRANSITIONS.get(current["status"], [])
        if body.status not in allowed:
            raise HTTPException(
                status_code=409,
                detail=f"Cannot move from '{current['status']}' to '{body.status}'. Allowed: {allowed}",
            )
        row = await conn.fetchrow(
            """
            UPDATE admissions
               SET status = $1, rejected_reason = $2, updated_at = NOW()
             WHERE id = $3 AND tenant_id = $4
             RETURNING *
            """,
            body.status, body.reason if body.status == "rejected" else None,
            admission_id, tid,
        )
        await emit(conn, "ADMISSION_STATUS_CHANGED", tid, {
            "admission_id": str(admission_id),
            "from_status": current["status"],
            "to_status": body.status,
        })
    return dict(row)


@router.post("/{admission_id}/enrol", dependencies=[_PRINCIPAL])
async def enrol_student(admission_id: UUID, body: EnrolRequest, request: Request):
    """
    Orchestrated enrolment transaction (principal only):
    1. Validate admission is in 'approved' status
    2. Create student record
    3. Generate fee ledger for the academic year
    4. Mark admission as enrolled + link student_id
    5. Emit ADMISSION_APPROVED
    """
    pool = request.app.state.pool
    tid = request.state.tenant_id
    user_id = UUID(request.state.user_id)

    async with pool.acquire() as conn:
        async with conn.transaction():
            adm = await conn.fetchrow(
                "SELECT * FROM admissions WHERE id=$1 AND tenant_id=$2 FOR UPDATE",
                admission_id, tid,
            )
            if not adm:
                raise HTTPException(status_code=404, detail="Admission not found")
            if adm["status"] != "approved":
                raise HTTPException(status_code=409, detail=f"Admission must be in 'approved' status; currently '{adm['status']}'")

            # Generate admission number if not provided
            if body.adm_no:
                adm_no = body.adm_no.strip()
            else:
                seq = await conn.fetchval(
                    "SELECT COALESCE(MAX(CAST(REGEXP_REPLACE(admission_no,'[^0-9]','','g') AS INTEGER)),0)+1 FROM students WHERE tenant_id=$1",
                    tid,
                )
                adm_no = str(seq).zfill(4)

            # Create student record
            student = await conn.fetchrow(
                """
                INSERT INTO students
                  (tenant_id, admission_no, first_name, last_name, date_of_birth,
                   academic_year_id, class_id, section_id, roll_number)
                VALUES ($1, $2, $3, '', $4::date, $5, $6, $7, $8)
                RETURNING id, admission_no
                """,
                tid, adm_no,
                adm["applicant_name"],  # first_name = full name for now
                adm["applicant_dob"],
                body.academic_year_id, body.class_id, body.section_id,
                body.roll_number,
            )

            # Generate fee ledger for this student + year
            try:
                await generate_ledger(
                    conn, tid,
                    GenerateLedgerRequest(
                        academic_year_id=body.academic_year_id,
                        class_id=body.class_id,
                        section_id=body.section_id,
                    ),
                )
            except Exception:
                pass  # If no schedules exist yet, skip silently

            # Mark admission as enrolled
            await conn.execute(
                "UPDATE admissions SET status='enrolled', student_id=$1, updated_at=NOW() WHERE id=$2",
                student["id"], admission_id,
            )

            await emit(conn, "ADMISSION_APPROVED", tid, {
                "admission_id": str(admission_id),
                "student_id": str(student["id"]),
                "admission_no": adm_no,
                "applicant_name": adm["applicant_name"],
                "enrolled_by": str(user_id),
            })

    return {
        "student_id": str(student["id"]),
        "adm_no": adm_no,
        "status": "enrolled",
        "message": f"Student enrolled successfully. Admission number: {adm_no}",
    }
