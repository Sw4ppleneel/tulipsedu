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
    OfflineCollectRequest,
    OutstandingReport,
    PendingPaymentRow,
    RejectRequest,
    SetDiscountsRequest,
    StudentDiscountResponse,
    StudentLedger,
    WaiveRequest,
)
from services import fee_collection, parent_payment
from services.finance import (
    FinanceError,
    create_fee_head,
    generate_ledger,
    get_outstanding_dues,
    get_payment_logs,
    get_student_ledger,
    import_and_generate,
    list_fee_heads,
    list_fee_schedules,
    list_student_discounts,
    set_student_discounts,
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


# ── UPI payment verification queue (parent self-reported claims) ──────────────

@router.get("/payments/pending", response_model=list[PendingPaymentRow], dependencies=[_collect])
async def pending_payments(request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await parent_payment.list_pending(conn, request.state.tenant_id)


@router.post("/payments/{payment_id}/approve", dependencies=[_collect])
async def approve_payment(payment_id: UUID, request: Request):
    user_id = UUID(request.state.user_id)
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        try:
            result = await parent_payment.approve(conn, request.state.tenant_id, user_id, payment_id)
        except parent_payment.ParentPaymentError as e:
            raise HTTPException(status_code=404, detail=str(e))
    return {"status": "paid", "receipt_number": result.receipt_number}


@router.post("/payments/{payment_id}/reject", status_code=204, dependencies=[_collect])
async def reject_payment(payment_id: UUID, body: RejectRequest, request: Request):
    user_id = UUID(request.state.user_id)
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        try:
            await parent_payment.reject(conn, request.state.tenant_id, user_id, payment_id, body.reason)
        except parent_payment.ParentPaymentError as e:
            raise HTTPException(status_code=404, detail=str(e))


@router.post("/collect", dependencies=[_collect])
async def collect_offline(body: OfflineCollectRequest, request: Request):
    """Record an office payment (cash/cheque/UPI/bank) → marks the fees paid + receipt."""
    user_id = UUID(request.state.user_id)
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        try:
            return await fee_collection.record_offline_payment(
                conn, request.state.tenant_id, user_id,
                body.student_id, body.ledger_ids, body.method, body.reference_no,
            )
        except fee_collection.CollectionError as e:
            raise HTTPException(status_code=400, detail=str(e))


@router.post("/waive", dependencies=[_collect])
async def waive_fees(body: WaiveRequest, request: Request):
    """Waive the selected unpaid fees (mandatory reason). A revenue decision,
    not a payment — no receipt, never counted as collected."""
    user_id = UUID(request.state.user_id)
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        try:
            return await fee_collection.waive_fees(
                conn, request.state.tenant_id, user_id,
                body.student_id, body.ledger_ids, body.reason,
            )
        except fee_collection.CollectionError as e:
            raise HTTPException(status_code=400, detail=str(e))


# ── Student fee discounts (sibling concessions etc.) ─────────────────────────

_discount_admin = Depends(require_roles("principal", "vice_principal"))


@router.get("/discounts", response_model=list[StudentDiscountResponse])
async def get_student_discounts(request: Request, student_id: UUID = Query(...)):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await list_student_discounts(conn, request.state.tenant_id, student_id)


@router.put("/discounts", dependencies=[_discount_admin])
async def put_student_discounts(body: SetDiscountsRequest, request: Request):
    """Replace a student's discount set (empty items clears it). Unpaid ledger
    rows are recomputed from the schedule base amounts in the same transaction."""
    user_id = UUID(request.state.user_id)
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        try:
            return await set_student_discounts(
                conn, request.state.tenant_id, user_id,
                body.student_id, body.items, body.reason,
            )
        except FinanceError as e:
            raise HTTPException(status_code=404, detail=str(e))


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
            return await import_and_generate(
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
    limit: int = Query(500, ge=1, le=5000),
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


@router.get("/defaulters")
async def defaulters(
    request: Request,
    class_id: Optional[UUID] = Query(None),
    section_id: Optional[UUID] = Query(None),
    academic_year_id: Optional[UUID] = Query(None),
    format: str = Query("json"),
):
    """Overdue fee ledger rows, grouped by student. format=csv returns a downloadable file."""
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT fl.id, fl.student_id, fl.fee_head_id, fl.amount_due,
                   fl.period_month, fl.period_year, fl.status, fl.due_date,
                   st.admission_no, st.first_name || ' ' || st.last_name AS student_name,
                   st.roll_number,
                   c.name AS class_name, sec.name AS section_name,
                   fh.name AS fee_head_name
            FROM fee_ledger fl
            JOIN students st ON st.id = fl.student_id
            JOIN classes c ON c.id = st.class_id
            JOIN sections sec ON sec.id = st.section_id
            JOIN fee_heads fh ON fh.id = fl.fee_head_id
            WHERE fl.tenant_id = $1
              AND fl.status = 'overdue'
              AND st.is_active = TRUE
              AND ($2::uuid IS NULL OR st.class_id = $2::uuid)
              AND ($3::uuid IS NULL OR st.section_id = $3::uuid)
              AND ($4::uuid IS NULL OR fl.academic_year_id = $4::uuid)
            ORDER BY c.name, sec.name, st.roll_number, fl.due_date
            """,
            request.state.tenant_id, class_id, section_id, academic_year_id,
        )

    if format == "csv":
        require_export_role(request)
        headers = ["Admission No", "Name", "Roll", "Class", "Section", "Fee Head", "Period", "Amount Due", "Due Date"]
        csv_rows = []
        for r in rows:
            period = (
                f"{r['period_year']}-{r['period_month']:02d}" if r["period_month"]
                else f"{r['period_year']} (Annual)"
            )
            csv_rows.append([
                r["admission_no"], r["student_name"], r["roll_number"],
                r["class_name"], r["section_name"], r["fee_head_name"],
                period, str(r["amount_due"]), str(r["due_date"] or ""),
            ])
        return csv_response(headers, csv_rows, "defaulters.csv")

    # Group by student for JSON response
    from collections import defaultdict
    grouped: dict = defaultdict(lambda: {"student_id": None, "admission_no": None, "student_name": None,
                                          "class_name": None, "section_name": None, "total_overdue": 0,
                                          "entries": []})
    for r in rows:
        sid = str(r["student_id"])
        g = grouped[sid]
        g["student_id"] = sid
        g["admission_no"] = r["admission_no"]
        g["student_name"] = r["student_name"]
        g["roll_number"] = r["roll_number"]
        g["class_name"] = r["class_name"]
        g["section_name"] = r["section_name"]
        g["total_overdue"] = float(g["total_overdue"]) + float(r["amount_due"])
        period = (
            f"{r['period_year']}-{r['period_month']:02d}" if r["period_month"]
            else f"{r['period_year']} (Annual)"
        )
        g["entries"].append({
            "id": str(r["id"]),
            "fee_head_name": r["fee_head_name"],
            "period": period,
            "amount_due": float(r["amount_due"]),
            "due_date": r["due_date"].isoformat() if r["due_date"] else None,
        })
    return {"total_students": len(grouped), "defaulters": list(grouped.values())}


@router.get("/recovery")
async def fee_recovery(
    request: Request,
    academic_year_id: Optional[UUID] = Query(None),
):
    """Fee recovery rate per class + school-wide. Used by the analytics dashboard."""
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT c.name AS class_name, c.id AS class_id,
                   COALESCE(SUM(fl.amount_due) FILTER (WHERE fl.status = 'paid'), 0)   AS collected,
                   COALESCE(SUM(fl.amount_due) FILTER (WHERE fl.status != 'waived'), 0) AS expected
            FROM fee_ledger fl
            JOIN students st ON st.id = fl.student_id AND st.tenant_id = fl.tenant_id
            JOIN classes c ON c.id = st.class_id
            WHERE fl.tenant_id = $1
              AND ($2::uuid IS NULL OR fl.academic_year_id = $2::uuid)
              AND st.is_active = TRUE
            GROUP BY c.id, c.name
            ORDER BY c.name
            """,
            request.state.tenant_id, academic_year_id,
        )
    total_collected = sum(float(r["collected"]) for r in rows)
    total_expected = sum(float(r["expected"]) for r in rows)
    return {
        "school_wide": {
            "collected": total_collected,
            "expected": total_expected,
            "rate_pct": round(total_collected / total_expected * 100, 1) if total_expected else 0,
        },
        "by_class": [
            {
                "class_id": str(r["class_id"]),
                "class_name": r["class_name"],
                "collected": float(r["collected"]),
                "expected": float(r["expected"]),
                "rate_pct": round(float(r["collected"]) / float(r["expected"]) * 100, 1) if r["expected"] else 0,
            }
            for r in rows
        ],
    }


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
