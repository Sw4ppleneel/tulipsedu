from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile

from core.rbac import require_roles
from models.timetable import SlotResponse, SlotUpsert, WeeklyTimetable
from services import timetable as svc
from services.timetable import TimetableError

# All staff may read the timetable; only principal/vice_principal edit it.
router = APIRouter(
    prefix="/timetable",
    tags=["Timetable"],
    dependencies=[
        Depends(require_roles("principal", "vice_principal", "class_teacher", "teacher")),
    ],
)

_edit = Depends(require_roles("principal", "vice_principal"))


@router.put("/slots", response_model=SlotResponse, dependencies=[_edit])
async def upsert_slot(body: SlotUpsert, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await svc.upsert_slot(conn, request.state.tenant_id, body)


@router.delete("/slots", status_code=204, dependencies=[_edit])
async def delete_slot(
    request: Request,
    academic_year_id: UUID = Query(...),
    class_id: UUID = Query(...),
    section_id: UUID = Query(...),
    day_of_week: int = Query(..., ge=1, le=6),
    period_number: int = Query(..., ge=1, le=12),
):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        ok = await svc.delete_slot(
            conn, request.state.tenant_id,
            academic_year_id, class_id, section_id, day_of_week, period_number,
        )
    if not ok:
        raise HTTPException(404, "Slot not found")


@router.get("/class", response_model=WeeklyTimetable)
async def get_class_timetable(
    request: Request,
    academic_year_id: UUID = Query(...),
    class_id: UUID = Query(...),
    section_id: UUID = Query(...),
):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await svc.get_weekly_timetable(
            conn, request.state.tenant_id, academic_year_id, class_id, section_id
        )


@router.get("/staff/{staff_id}", response_model=list[SlotResponse])
async def get_staff_timetable(
    staff_id: UUID,
    request: Request,
    academic_year_id: UUID = Query(...),
):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await svc.get_staff_timetable(
            conn, request.state.tenant_id, academic_year_id, staff_id
        )


@router.post("/import", dependencies=[_edit])
async def import_timetable_xlsx(
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
            return await svc.import_timetable(
                conn, request.state.tenant_id, academic_year_id, contents
            )
        except TimetableError as e:
            raise HTTPException(status_code=422, detail=str(e))
