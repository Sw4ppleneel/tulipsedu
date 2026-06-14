from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from core.rbac import require_roles
from models.student import AcademicYearCreate, AcademicYearResponse
from services.student import StudentError, create_academic_year, list_academic_years, rollover_academic_year, set_current_year

class RolloverRequest(BaseModel):
    to_year_id: UUID

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


@router.post(
    "/{year_id}/rollover",
    dependencies=[Depends(require_roles("principal"))],
    status_code=200,
)
async def rollover(year_id: UUID, body: RolloverRequest, request: Request):
    """
    Orchestrated academic-year rollover (principal only).
    Archives year_id; promotes body.to_year_id to current.
    Carries forward unpaid fees; clones timetable slots.
    """
    pool = request.app.state.pool
    user_id = UUID(request.state.user_id)
    async with pool.acquire() as conn:
        try:
            return await rollover_academic_year(
                conn, request.state.tenant_id,
                year_id, body.to_year_id, user_id,
            )
        except StudentError as e:
            raise HTTPException(status_code=409, detail=str(e))
