import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from core.rbac import require_roles
from models.notification import NotificationResponse, UnreadCount
from services.notification import (
    list_for_recipient,
    mark_all_read,
    mark_read,
    unread_count,
)

# Staff-only: parent JWTs (role='parent', sub=student_id) use /parent/notifications.
router = APIRouter(
    prefix="/notifications",
    tags=["Notifications"],
    dependencies=[Depends(require_roles(
        "principal", "vice_principal", "class_teacher", "teacher", "accountant"
    ))],
)


def _staff_recipient(request: Request) -> uuid.UUID:
    return uuid.UUID(request.state.user_id)


@router.get("", response_model=list[NotificationResponse])
async def list_notifications(
    request: Request,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await list_for_recipient(
            conn, request.state.tenant_id, "user", _staff_recipient(request),
            limit=limit, offset=offset,
        )


@router.get("/unread-count", response_model=UnreadCount)
async def get_unread_count(request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        n = await unread_count(
            conn, request.state.tenant_id, "user", _staff_recipient(request)
        )
    return UnreadCount(unread=n)


@router.post("/read-all", response_model=UnreadCount)
async def read_all(request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        await mark_all_read(
            conn, request.state.tenant_id, "user", _staff_recipient(request)
        )
    return UnreadCount(unread=0)


@router.post("/{notification_id}/read", status_code=204)
async def read_one(notification_id: uuid.UUID, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        ok = await mark_read(
            conn, request.state.tenant_id, "user", _staff_recipient(request),
            notification_id,
        )
    if not ok:
        raise HTTPException(status_code=404, detail="Notification not found")
