from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile

from core.csv_export import csv_response, require_export_role
from core.rbac import assert_in_scope, load_class_scope, require_roles
from models.student import (
    PortalPasswordReset,
    StudentContactUpdate,
    StudentCreate,
    StudentListResponse,
    StudentResponse,
    StudentUpdate,
)
from services.student import (
    StudentError,
    create_student,
    deactivate_student,
    get_student,
    import_students,
    list_students,
    reset_portal_password,
    set_parent_phone,
    update_student,
)

_admin_only = Depends(require_roles("principal", "vice_principal"))
_roster_read = [
    # accountant: needs the roster to pick a student when collecting fees at
    # the office (FeesAdmin's Collect tab) — was 403ing before this.
    Depends(require_roles("principal", "vice_principal", "class_teacher", "teacher", "accountant")),
    Depends(load_class_scope),
]

router = APIRouter(prefix="/students", tags=["students"])


@router.post("", response_model=StudentResponse, status_code=201, dependencies=[_admin_only])
async def add_student(data: StudentCreate, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        try:
            return await create_student(conn, request.state.tenant_id, data)
        except StudentError as e:
            raise HTTPException(status_code=409, detail=str(e))


@router.get("", response_model=StudentListResponse, dependencies=_roster_read)
async def get_students(
    request: Request,
    academic_year_id: Optional[UUID] = Query(None),
    class_id: Optional[UUID] = Query(None),
    section_id: Optional[UUID] = Query(None),
    limit: int = Query(100, ge=1, le=5000),
    offset: int = Query(0, ge=0),
):
    scope = getattr(request.state, "class_scope", None)
    if scope is not None:
        # Teacher/class_teacher: must specify class+section and must be in their scope.
        if not class_id or not section_id:
            raise HTTPException(status_code=400, detail="class_id and section_id are required")
        assert_in_scope(request, class_id, section_id)
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await list_students(
            conn,
            request.state.tenant_id,
            academic_year_id=academic_year_id,
            class_id=class_id,
            section_id=section_id,
            limit=limit,
            offset=offset,
        )


# Teaching roles may update the registered parent phone + reset the parent-portal
# password for students in their own class (scope-asserted per request); admin
# tier is unrestricted. This backs the parent-password rollout: teachers collect
# real phone numbers, then the last-4-digits default password works.
_contact_roles = [
    Depends(require_roles("principal", "vice_principal", "class_teacher", "teacher")),
    Depends(load_class_scope),
]


async def _load_scoped_student(request: Request, student_id: UUID) -> StudentResponse:
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        student = await get_student(conn, request.state.tenant_id, student_id)
    if not student or not student.is_active:
        raise HTTPException(status_code=404, detail="Student not found")
    assert_in_scope(request, student.class_id, student.section_id)
    return student


@router.patch("/{student_id}/contact", dependencies=_contact_roles)
async def update_student_contact(student_id: UUID, data: StudentContactUpdate, request: Request):
    await _load_scoped_student(request, student_id)
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        updated = await set_parent_phone(
            conn, request.state.tenant_id, student_id, data.parent_phone
        )
    if not updated:
        raise HTTPException(status_code=404, detail="Student not found")
    return {"detail": "Parent phone updated", "parent_phone": data.parent_phone}


@router.put("/{student_id}/portal-password", dependencies=_contact_roles)
async def reset_student_portal_password(
    student_id: UUID, data: PortalPasswordReset, request: Request
):
    await _load_scoped_student(request, student_id)
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        try:
            updated = await reset_portal_password(
                conn, request.state.tenant_id, student_id,
                data.new_password, request.state.user_role,
            )
        except StudentError as e:
            raise HTTPException(status_code=422, detail=str(e))
    if not updated:
        raise HTTPException(status_code=404, detail="Student not found")
    return {"detail": "Portal password reset"}


# Export must be declared BEFORE /{student_id} to prevent UUID matching /export.csv
@router.get("/export.csv", dependencies=[_admin_only])
async def export_students_csv(
    request: Request,
    academic_year_id: Optional[UUID] = Query(None),
    class_id: Optional[UUID] = Query(None),
    section_id: Optional[UUID] = Query(None),
):
    require_export_role(request)
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        result = await list_students(
            conn, request.state.tenant_id,
            academic_year_id=academic_year_id,
            class_id=class_id, section_id=section_id,
            limit=50_000, offset=0,
        )
    headers = [
        "Roll No", "Admission No", "First Name", "Last Name",
        "Class", "Section", "Academic Year", "Gender", "Date of Birth",
        "Parent Phone", "Hosteler", "Active", "Enrolled On",
    ]
    rows = [
        [
            s.roll_number, s.admission_no, s.first_name, s.last_name,
            s.class_name or "", s.section_name or "", s.academic_year_name or "",
            s.gender, str(s.date_of_birth), s.parent_phone,
            "Yes" if s.is_hosteler else "No",
            "Yes" if s.is_active else "No",
            str(s.created_at.date()),
        ]
        for s in result.items
    ]
    return csv_response(headers, rows, "students.csv")


@router.get("/{student_id}", response_model=StudentResponse, dependencies=[_admin_only])
async def get_one(student_id: UUID, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        student = await get_student(conn, request.state.tenant_id, student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    return student


@router.put("/{student_id}", response_model=StudentResponse, dependencies=[_admin_only])
async def edit_student(student_id: UUID, data: StudentUpdate, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        try:
            student = await update_student(conn, request.state.tenant_id, student_id, data)
        except StudentError as e:
            raise HTTPException(status_code=409, detail=str(e))
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    return student


@router.delete("/{student_id}", status_code=204, dependencies=[_admin_only])
async def remove_student(student_id: UUID, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        deleted = await deactivate_student(conn, request.state.tenant_id, student_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Student not found or already inactive")


@router.post("/import", dependencies=[_admin_only])
async def import_students_xlsx(
    request: Request,
    academic_year_id: UUID = Query(...),
    file: UploadFile = File(...),
):
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Only .xlsx files are accepted")
    contents = await file.read()
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        try:
            return await import_students(conn, request.state.tenant_id, academic_year_id, contents)
        except StudentError as e:
            raise HTTPException(status_code=422, detail=str(e))
