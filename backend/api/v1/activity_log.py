from fastapi import APIRouter, Depends, Query, Request

from core.rbac import require_roles
from models.activity_log import ActivityLogEntry
from services.activity_log import list_activity

router = APIRouter(
    prefix="/activity-log",
    tags=["activity-log"],
    dependencies=[Depends(require_roles("principal", "vice_principal"))],
)


@router.get("", response_model=list[ActivityLogEntry])
async def get_activity_log(
    request: Request,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await list_activity(conn, request.state.tenant_id, limit=limit, offset=offset)
