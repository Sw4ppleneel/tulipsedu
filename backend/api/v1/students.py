from typing import Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request

from models.student import StudentCreate, StudentListResponse, StudentResponse, StudentUpdate
from services.student import (
    StudentError,
    create_student,
    deactivate_student,
    get_student,
    list_students,
    update_student,
)

router = APIRouter(prefix="/students", tags=["students"])


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
