"""Admissions pipeline — enquiry→application→docs_pending→approved→enrolled/rejected."""

import json
from datetime import date
from typing import Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from jose import JWTError
from pydantic import BaseModel, field_validator

from config import settings
from core.events import emit
from core.phone import normalize_indian_mobile
from core.rbac import require_roles
from core.r2 import R2ClientError, r2_client, r2_enabled
from core.security import create_upload_token, decode_token
from services.finance import generate_ledger, _derive_month_year_pairs
from models.finance import GenerateLedgerRequest

router = APIRouter(prefix="/admissions", tags=["admissions"])

# Public admission-document upload constraints (matric marksheet, TC, etc.).
ADMISSION_DOC_CONTENT_TYPES = {"application/pdf", "image/jpeg", "image/png"}
_EXT_FOR_TYPE = {"application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png"}
MAX_ADMISSION_DOC_BYTES = 5 * 1024 * 1024  # 5 MB per document

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

    @field_validator("parent_phone")
    @classmethod
    def validate_phone(cls, v: Optional[str]) -> Optional[str]:
        # Public form — validate when provided, allow blank (enquiry may omit it).
        return normalize_indian_mobile(v) if v else v


class StatusAdvance(BaseModel):
    status: str
    reason: Optional[str] = None


class EnrolRequest(BaseModel):
    academic_year_id: UUID
    class_id: UUID
    section_id: UUID
    roll_number: str
    gender: str
    adm_no: Optional[str] = None
    # Defaulted from the admission record when omitted; students.* are NOT NULL.
    parent_phone: Optional[str] = None
    date_of_birth: Optional[date] = None

    @field_validator("parent_phone")
    @classmethod
    def validate_phone(cls, v: Optional[str]) -> Optional[str]:
        return normalize_indian_mobile(v) if v else v


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

    resp = {
        "id": str(row["id"]),
        "status": row["status"],
        "message": "Enquiry received. We will contact you shortly.",
    }
    # Schools that collect documents online (feature-gated) get a short-lived
    # token so the applicant can upload supporting files for THIS enquiry only.
    flags = getattr(request.state, "feature_flags", {}) or {}
    if flags.get("admission_docs"):
        resp["upload_token"] = create_upload_token(row["id"], tid)
    return resp


# ── Public admission-document upload (no auth; admission-scoped token) ─────────

class DocUploadUrlRequest(BaseModel):
    token: str
    filename: str
    content_type: str


class DocConfirmRequest(BaseModel):
    token: str
    object_key: str
    name: str


def _verify_upload_token(token: str, tenant_id) -> dict:
    """Validate an admission upload token; returns its claims or raises 401/403."""
    try:
        claims = decode_token(token)
    except JWTError:
        raise HTTPException(status_code=401, detail="Upload link expired. Please submit the form again.")
    if claims.get("type") != "admission_upload":
        raise HTTPException(status_code=401, detail="Invalid upload token.")
    if str(claims.get("tenant_id")) != str(tenant_id):
        raise HTTPException(status_code=403, detail="Tenant mismatch.")
    return claims


def _require_docs_enabled(request: Request):
    flags = getattr(request.state, "feature_flags", {}) or {}
    if not flags.get("admission_docs"):
        raise HTTPException(status_code=403, detail="Online document upload is not enabled for this school.")
    if not r2_enabled():
        raise HTTPException(status_code=501, detail="File uploads are not configured.")


@router.post("/documents/upload-url")
async def admission_doc_upload_url(body: DocUploadUrlRequest, request: Request):
    """Mint a presigned PUT URL for one admission document. The object is keyed
    under the enquiry so it can only land in that admission's namespace."""
    tid = request.state.tenant_id
    _require_docs_enabled(request)
    claims = _verify_upload_token(body.token, tid)
    admission_id = claims["admission_id"]

    if body.content_type not in ADMISSION_DOC_CONTENT_TYPES:
        raise HTTPException(status_code=415, detail="Only PDF, JPG, or PNG files are allowed.")

    ext = _EXT_FOR_TYPE[body.content_type]
    key = f"{tid}/admissions/{admission_id}/{uuid4()}.{ext}"
    client = r2_client()
    upload_url = client.generate_presigned_url(
        "put_object",
        Params={"Bucket": settings.r2_bucket_name, "Key": key, "ContentType": body.content_type},
        ExpiresIn=300,
    )
    public_url = f"{settings.r2_public_url.rstrip('/')}/{key}"
    return {"upload_url": upload_url, "object_key": key, "public_url": public_url}


@router.post("/documents/confirm")
async def admission_doc_confirm(body: DocConfirmRequest, request: Request):
    """Verify the uploaded object (type + size) and attach its metadata to the
    enquiry. Rejects + deletes anything outside the allowlist/size cap."""
    tid = request.state.tenant_id
    _require_docs_enabled(request)
    claims = _verify_upload_token(body.token, tid)
    admission_id = claims["admission_id"]

    prefix = f"{tid}/admissions/{admission_id}/"
    if not body.object_key.startswith(prefix):
        raise HTTPException(status_code=403, detail="Object does not belong to this enquiry.")

    client = r2_client()
    try:
        head = client.head_object(Bucket=settings.r2_bucket_name, Key=body.object_key)
    except R2ClientError:
        raise HTTPException(status_code=404, detail="Uploaded file not found.")

    size = head.get("ContentLength", 0)
    ctype = head.get("ContentType", "")
    if size == 0 or size > MAX_ADMISSION_DOC_BYTES or ctype not in ADMISSION_DOC_CONTENT_TYPES:
        client.delete_object(Bucket=settings.r2_bucket_name, Key=body.object_key)
        raise HTTPException(
            status_code=413,
            detail=f"File rejected — must be PDF/JPG/PNG up to {MAX_ADMISSION_DOC_BYTES // (1024 * 1024)} MB.",
        )

    public_url = f"{settings.r2_public_url.rstrip('/')}/{body.object_key}"
    doc = {"name": body.name[:120], "url": public_url, "key": body.object_key}
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE admissions
               SET documents = documents || $1::jsonb, updated_at = NOW()
             WHERE id = $2 AND tenant_id = $3
             RETURNING id
            """,
            json.dumps([doc]), UUID(admission_id), tid,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Enquiry not found.")
        await emit(conn, "ADMISSION_DOCUMENT_UPLOADED", tid, {
            "admission_id": str(admission_id),
            "document_name": doc["name"],
        })
    return {"ok": True, "url": public_url, "name": doc["name"]}


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
                   a.parent_name, a.parent_phone, a.notes, a.documents,
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

            # students.gender / parent_phone / date_of_birth / roll_number are all
            # NOT NULL. The admissions record may not carry phone/dob, so fall back
            # to it and reject up front with a 400 (never let a NOT NULL violation
            # surface as a 500).
            gender = body.gender.strip()
            roll_number = body.roll_number.strip()
            raw_phone = (body.parent_phone or adm["parent_phone"] or "").strip()
            date_of_birth = body.date_of_birth or adm["applicant_dob"]
            if not gender:
                raise HTTPException(status_code=400, detail="Gender is required to enrol")
            if not roll_number:
                raise HTTPException(status_code=400, detail="Roll number is required to enrol")
            if not raw_phone:
                raise HTTPException(status_code=400, detail="Parent phone is required to enrol")
            try:
                parent_phone = normalize_indian_mobile(raw_phone)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc))
            if not date_of_birth:
                raise HTTPException(status_code=400, detail="Date of birth is required to enrol")

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
                   academic_year_id, class_id, section_id, roll_number, gender, parent_phone)
                VALUES ($1, $2, $3, '', $4::date, $5, $6, $7, $8, $9, $10)
                RETURNING id, admission_no
                """,
                tid, adm_no,
                adm["applicant_name"],  # first_name = full name for now
                date_of_birth,
                body.academic_year_id, body.class_id, body.section_id,
                roll_number, gender, parent_phone,
            )

            # Generate fee ledger for this student + year. generate_ledger scans all
            # active students in the year with ON CONFLICT DO NOTHING, so it is
            # idempotent for already-enrolled peers and a no-op when no fee schedules
            # exist yet. Runs inside the enrol transaction so a real failure rolls the
            # whole enrolment back rather than silently enrolling a student with no fees.
            pairs = await _derive_month_year_pairs(conn, tid, body.academic_year_id)
            await generate_ledger(
                conn, tid,
                GenerateLedgerRequest(
                    academic_year_id=body.academic_year_id,
                    month_year_pairs=pairs,
                    include_annual=True,
                ),
            )

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
