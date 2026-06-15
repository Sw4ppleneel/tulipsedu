from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

from core.rbac import require_roles
from models.payroll import (
    PayrollRunCreate,
    PayrollRunResponse,
    PayslipResponse,
    PayslipUpdate,
    SalaryStructureResponse,
    SalaryStructureUpsert,
)
from services import payroll
from services.payslip_pdf import render_payslip_pdf

# Payroll holds salary figures — principal only (most sensitive staff data).
router = APIRouter(
    prefix="/payroll",
    tags=["payroll"],
    dependencies=[Depends(require_roles("principal"))],
)


# ── Salary structure (per staff — fronts the "tap staff → set salary" flow) ──

@router.get("/staff/{staff_id}/salary", response_model=SalaryStructureResponse | None)
async def get_salary(staff_id: UUID, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await payroll.get_salary_structure(conn, request.state.tenant_id, staff_id)


@router.put("/staff/{staff_id}/salary", response_model=SalaryStructureResponse)
async def set_salary(staff_id: UUID, data: SalaryStructureUpsert, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        try:
            return await payroll.upsert_salary_structure(
                conn, request.state.tenant_id, staff_id,
                data.gross_salary,
                [c.model_dump() for c in data.components],
                data.effective_from,
            )
        except payroll.PayrollError as e:
            raise HTTPException(status_code=404, detail=str(e))


@router.get("/staff/{staff_id}/payslips")
async def staff_payslips(staff_id: UUID, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await payroll.list_staff_payslips(conn, request.state.tenant_id, staff_id)


# ── Payroll runs ─────────────────────────────────────────────────────────────

@router.get("/runs", response_model=list[PayrollRunResponse])
async def list_runs(request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await payroll.list_runs(conn, request.state.tenant_id)


@router.post("/runs", response_model=PayrollRunResponse, status_code=201)
async def create_run(data: PayrollRunCreate, request: Request):
    user_id = UUID(request.state.user_id)
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        try:
            return await payroll.create_run(
                conn, request.state.tenant_id, user_id, data.period_month, data.period_year
            )
        except payroll.PayrollError as e:
            raise HTTPException(status_code=409, detail=str(e))


@router.get("/runs/{run_id}/payslips", response_model=list[PayslipResponse])
async def run_payslips(run_id: UUID, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await payroll.get_run_payslips(conn, request.state.tenant_id, run_id)


@router.post("/runs/{run_id}/finalize", response_model=PayrollRunResponse)
async def finalize_run(run_id: UUID, request: Request):
    user_id = UUID(request.state.user_id)
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        try:
            return await payroll.finalize_run(conn, request.state.tenant_id, user_id, run_id)
        except payroll.PayrollError as e:
            raise HTTPException(status_code=409, detail=str(e))


# ── Payslips ─────────────────────────────────────────────────────────────────

@router.patch("/payslips/{payslip_id}", response_model=PayslipResponse)
async def update_payslip(payslip_id: UUID, data: PayslipUpdate, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        try:
            return await payroll.update_payslip(
                conn, request.state.tenant_id, payslip_id,
                [a.model_dump() for a in data.allowances],
                [d.model_dump() for d in data.deductions],
                data.note,
            )
        except payroll.PayrollError as e:
            raise HTTPException(status_code=409, detail=str(e))


@router.get("/payslips/{payslip_id}.pdf")
async def payslip_pdf(payslip_id: UUID, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        ctx = await payroll.get_payslip_context(conn, request.state.tenant_id, payslip_id)
    if not ctx:
        raise HTTPException(status_code=404, detail="Payslip not found")
    pdf = render_payslip_pdf(ctx)
    filename = f"payslip-{ctx['employee_no']}-{ctx['period_year']}-{ctx['period_month']:02d}.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
