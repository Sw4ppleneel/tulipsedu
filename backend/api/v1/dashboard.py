from fastapi import APIRouter, Depends, Request

from core.rbac import require_roles

router = APIRouter(
    prefix="/dashboard",
    tags=["Dashboard"],
    dependencies=[Depends(require_roles("principal", "vice_principal"))],
)


@router.get("")
async def stats(request: Request):
    pool = request.app.state.pool
    tid = request.state.tenant_id
    async with pool.acquire() as conn:
        students = await conn.fetchval(
            "SELECT COUNT(*) FROM students WHERE tenant_id=$1 AND is_active=TRUE", tid
        )
        staff = await conn.fetchval(
            "SELECT COUNT(*) FROM staff WHERE tenant_id=$1 AND is_active=TRUE", tid
        )
        fee_outstanding = await conn.fetchval(
            "SELECT COALESCE(SUM(amount_due),0) FROM fee_ledger WHERE tenant_id=$1 AND status IN ('pending','due','overdue')",
            tid,
        )
        recent_hw = await conn.fetch(
            """
            SELECT hp.id, hp.title, hp.subject, hp.post_type, hp.due_date, hp.created_at,
                   c.name AS class_name, sec.name AS section_name
            FROM homework_posts hp
            JOIN classes c ON c.id = hp.class_id
            JOIN sections sec ON sec.id = hp.section_id
            WHERE hp.tenant_id=$1 AND hp.is_active=TRUE
            ORDER BY hp.created_at DESC LIMIT 6
            """,
            tid,
        )
        tenantrow = await conn.fetchrow(
            "SELECT name FROM tenants WHERE id=$1", tid
        )
    return {
        "school_name":      tenantrow["name"] if tenantrow else "",
        "total_students":   students or 0,
        "total_staff":      staff or 0,
        "fee_outstanding":  float(fee_outstanding or 0),
        "recent_homework":  [dict(r) for r in recent_hw],
    }
