from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from core.csv_export import csv_response, require_export_role
from core.rbac import require_roles
from models.student import StudentCreate, StudentListResponse, StudentResponse, StudentUpdate
from services.student import (
    StudentError,
    create_student,
    deactivate_student,
    get_student,
    list_students,
    update_student,
)

router = APIRouter(
    prefix="/students",
    tags=["students"],
    dependencies=[Depends(require_roles("principal", "vice_principal"))],
)


@router.post("", response_model=StudentResponse, status_code=201)
async def add_student(data: StudentCreate, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        try:
            return await create_student(conn, request.state.tenant_id, data)
        except StudentError as e:
            raise HTTPException(status_code=409, detail=str(e))


@router.get("", response_model=StudentListResponse)
async def get_students(
    request: Request,
    academic_year_id: Optional[UUID] = Query(None),
    class_id: Optional[UUID] = Query(None),
    section_id: Optional[UUID] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
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


# Export must be declared BEFORE /{student_id} to prevent UUID matching /export.csv
@router.get("/export.csv")
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


@router.get("/{student_id}", response_model=StudentResponse)
async def get_one(student_id: UUID, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        student = await get_student(conn, request.state.tenant_id, student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    return student


@router.put("/{student_id}", response_model=StudentResponse)
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


@router.delete("/{student_id}", status_code=204)
async def remove_student(student_id: UUID, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        deleted = await deactivate_student(conn, request.state.tenant_id, student_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Student not found or already inactive")
