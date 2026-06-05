from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile

from core.csv_export import csv_response, require_export_role
from core.rbac import require_roles
from models.finance import (
    FeeHeadCreate,
    FeeHeadResponse,
    FeeScheduleCreate,
    FeeScheduleResponse,
    GenerateLedgerRequest,
    OutstandingReport,
    StudentLedger,
)
from services.finance import (
    FinanceError,
    create_fee_head,
    generate_ledger,
    get_outstanding_dues,
    get_payment_logs,
    get_student_ledger,
    import_fee_structure_excel,
    list_fee_heads,
    list_fee_schedules,
    toggle_fee_head,
    upsert_fee_schedule,
)

# vice_principal may view fee data but not collect or restructure; mutations are
# limited to principal + accountant.
router = APIRouter(
    prefix="/fees",
    tags=["fees"],
    dependencies=[Depends(require_roles("principal", "vice_principal", "accountant"))],
)

_collect = Depends(require_roles("principal", "accountant"))


@router.post(
    "/heads", response_model=FeeHeadResponse, status_code=201, dependencies=[_collect]
)
async def add_head(data: FeeHeadCreate, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        try:
            return await create_fee_head(conn, request.state.tenant_id, data)
        except FinanceError as e:
            raise HTTPException(status_code=409, detail=str(e))


@router.get("/heads", response_model=list[FeeHeadResponse])
async def get_heads(request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await list_fee_heads(conn, request.state.tenant_id)


@router.patch(
    "/heads/{head_id}/toggle", response_model=FeeHeadResponse, dependencies=[_collect]
)
async def toggle_head(head_id: UUID, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        result = await toggle_fee_head(conn, request.state.tenant_id, head_id)
    if not result:
        raise HTTPException(status_code=404, detail="Fee head not found")
    return result


@router.post(
    "/schedules",
    response_model=FeeScheduleResponse,
    status_code=200,
    dependencies=[_collect],
)
async def set_schedule(data: FeeScheduleCreate, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await upsert_fee_schedule(conn, request.state.tenant_id, data)


@router.get("/schedules", response_model=list[FeeScheduleResponse])
async def get_schedules(
    request: Request,
    academic_year_id: Optional[UUID] = Query(None),
):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await list_fee_schedules(conn, request.state.tenant_id, academic_year_id)


@router.post("/import-excel", dependencies=[_collect])
async def import_excel(
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
            return await import_fee_structure_excel(
                conn, request.state.tenant_id, academic_year_id, contents
            )
        except FinanceError as e:
            raise HTTPException(status_code=422, detail=str(e))


@router.post("/generate-ledger", dependencies=[_collect])
async def gen_ledger(data: GenerateLedgerRequest, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await generate_ledger(conn, request.state.tenant_id, data)


@router.get("/ledger", response_model=StudentLedger)
async def student_ledger(
    request: Request,
    student_id: UUID = Query(...),
):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        try:
            return await get_student_ledger(conn, request.state.tenant_id, student_id)
        except FinanceError as e:
            raise HTTPException(status_code=404, detail=str(e))


@router.get("/outstanding", response_model=OutstandingReport)
async def outstanding(
    request: Request,
    class_id: Optional[UUID] = Query(None),
    section_id: Optional[UUID] = Query(None),
    academic_year_id: Optional[UUID] = Query(None),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await get_outstanding_dues(
            conn, request.state.tenant_id,
            class_id=class_id, section_id=section_id,
            academic_year_id=academic_year_id,
            limit=limit, offset=offset,
        )


@router.post("/reminders", dependencies=[_collect])
async def send_reminders(student_ids: list[UUID], request: Request):
    # Logs reminder events; SMS integration wired up when provider is configured
    from core.events import emit
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        for sid in student_ids:
            await emit(conn, "REMINDER_SENT", request.state.tenant_id, {"student_id": str(sid)})
    return {"queued": len(student_ids)}


@router.get("/export.csv")
async def export_fees_csv(
    request: Request,
    academic_year_id: Optional[UUID] = Query(None),
    class_id: Optional[UUID] = Query(None),
    section_id: Optional[UUID] = Query(None),
):
    require_export_role(request)
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        report = await get_outstanding_dues(
            conn, request.state.tenant_id,
            class_id=class_id, section_id=section_id,
            academic_year_id=academic_year_id,
            limit=50_000, offset=0,
        )
    headers = ["Admission No", "Name", "Roll No", "Class", "Section", "Pending Months", "Total Due (INR)"]
    rows = [[s.admission_no, s.student_name, s.roll_number, s.class_name, s.section_name,
             s.pending_entries, str(s.total_due)] for s in report.items]
    return csv_response(headers, rows, "outstanding_fees.csv")


@router.get("/logs")
async def payment_logs(
    request: Request,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await get_payment_logs(conn, request.state.tenant_id, limit=limit, offset=offset)


@router.get("/logs/export.csv")
async def export_logs_csv(request: Request):
    require_export_role(request)
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        logs = await get_payment_logs(conn, request.state.tenant_id, limit=50_000)
    headers = ["Receipt No", "Student", "Admission No", "Amount", "Gateway", "Method", "Status", "Paid At", "Created At"]
    rows = [[
        r.get("receipt_number", ""), r.get("student_name", ""), r.get("admission_no", ""),
        str(r.get("amount", "")), r.get("gateway", ""), r.get("payment_method", ""),
        r.get("status", ""), str(r.get("paid_at", "")), str(r.get("created_at", "")),
    ] for r in logs]
    return csv_response(headers, rows, "payment_logs.csv")
