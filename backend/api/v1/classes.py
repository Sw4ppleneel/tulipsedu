from uuid import UUID

from fastapi import APIRouter, HTTPException, Request

from models.student import ClassCreate, ClassResponse, SectionCreate, SectionResponse
from services.student import StudentError, create_class, create_section, list_classes

router = APIRouter(prefix="/classes", tags=["classes"])


@router.post("", response_model=ClassResponse, status_code=201)
async def add_class(data: ClassCreate, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        try:
            return await create_class(conn, request.state.tenant_id, data)
        except StudentError as e:
            raise HTTPException(status_code=409, detail=str(e))


@router.get("", response_model=list[ClassResponse])
async def get_classes(request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await list_classes(conn, request.state.tenant_id)


@router.post("/{class_id}/sections", response_model=SectionResponse, status_code=201)
async def add_section(class_id: UUID, data: SectionCreate, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        try:
            return await create_section(conn, request.state.tenant_id, class_id, data)
        except StudentError as e:
            raise HTTPException(status_code=409, detail=str(e))
