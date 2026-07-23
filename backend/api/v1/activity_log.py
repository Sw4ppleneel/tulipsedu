from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from core.rbac import require_roles
from models.activity_log import ActivityLogEntry
from services.activity_log import CATEGORIES, list_activity

router = APIRouter(
    prefix="/activity-log",
    tags=["activity-log"],
    dependencies=[Depends(require_roles("principal", "vice_principal"))],
)


@router.get("/categories")
async def get_categories():
    return {"categories": sorted(CATEGORIES.keys())}


@router.get("", response_model=list[ActivityLogEntry])
async def get_activity_log(
    request: Request,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    category: Optional[str] = Query(None),
):
    event_types = None
    if category:
        event_types = CATEGORIES.get(category)
        if event_types is None:
            raise HTTPException(status_code=400, detail=f"Unknown category '{category}'")
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await list_activity(
            conn, request.state.tenant_id, limit=limit, offset=offset, event_types=event_types
        )
