from uuid import UUID

from fastapi import APIRouter, HTTPException, Request

from models.student import AcademicYearCreate, AcademicYearResponse
from services.student import StudentError, create_academic_year, list_academic_years, set_current_year

router = APIRouter(prefix="/academic-years", tags=["academic-years"])


@router.post("", response_model=AcademicYearResponse, status_code=201)
async def create_year(data: AcademicYearCreate, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        try:
            return await create_academic_year(conn, request.state.tenant_id, data)
        except StudentError as e:
            raise HTTPException(status_code=409, detail=str(e))


@router.get("", response_model=list[AcademicYearResponse])
async def get_years(request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await list_academic_years(conn, request.state.tenant_id)


@router.patch("/{year_id}/set-current", response_model=AcademicYearResponse)
async def make_current(year_id: UUID, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        try:
            return await set_current_year(conn, request.state.tenant_id, year_id)
        except StudentError as e:
            raise HTTPException(status_code=404, detail=str(e))
