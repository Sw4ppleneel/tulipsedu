from fastapi import APIRouter, Depends, HTTPException, Query, Request

from core.csv_export import csv_response
from services.payment import get_superadmin_payment_log, get_superadmin_revenue

router = APIRouter(prefix="/superadmin", tags=["superadmin"])


def _require_superadmin(request: Request) -> None:
    role = getattr(request.state, "user_role", None)
    if role != "superadmin":
        raise HTTPException(status_code=403, detail="Superadmin access required")


@router.get("/revenue")
async def revenue(request: Request, _=Depends(_require_superadmin)):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await get_superadmin_revenue(conn)


@router.get("/payments")
async def payments(
    request: Request,
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    _=Depends(_require_superadmin),
):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await get_superadmin_payment_log(conn, limit=limit, offset=offset)


@router.get("/payments/export.csv")
async def export_csv(request: Request, _=Depends(_require_superadmin)):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        rows_data = await get_superadmin_payment_log(conn, limit=50_000)

    headers = [
        "School", "Slug", "Receipt No", "Student", "Admission No",
        "Amount", "Gateway", "Method", "Status", "Paid At", "Created At",
    ]
    rows = [[
        r.get("school_name", ""), r.get("tenant_slug", ""),
        r.get("receipt_number", ""), r.get("student_name", ""), r.get("admission_no", ""),
        str(r.get("amount", "")), r.get("gateway", ""), r.get("payment_method", ""),
        r.get("status", ""), str(r.get("paid_at", "")), str(r.get("created_at", "")),
    ] for r in rows_data]
    return csv_response(headers, rows, "all_schools_payments.csv")
