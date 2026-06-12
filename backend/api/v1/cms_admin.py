import uuid

from fastapi import APIRouter, Depends, HTTPException, Request

from core.rbac import require_roles
from models.cms import (
    AnnouncementCreate,
    AnnouncementResponse,
    AnnouncementUpdate,
    PageCreate,
    PageResponse,
    PageUpdate,
)
from services.cms import (
    CmsError,
    create_announcement,
    create_page,
    delete_announcement,
    delete_page,
    list_announcements,
    list_pages,
    update_announcement,
    update_page,
)

router = APIRouter(
    prefix="/cms",
    tags=["CMS Admin"],
    dependencies=[Depends(require_roles("principal"))],
)


# ── Pages ─────────────────────────────────────────────────────────────────────

@router.post("/pages", response_model=PageResponse, status_code=201)
async def add_page(body: PageCreate, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        try:
            return await create_page(conn, request.state.tenant_id, body)
        except CmsError as e:
            raise HTTPException(status_code=409, detail=str(e))


@router.get("/pages", response_model=list[PageResponse])
async def get_pages(request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await list_pages(conn, request.state.tenant_id, published_only=False)


@router.put("/pages/{page_id}", response_model=PageResponse)
async def edit_page(page_id: uuid.UUID, body: PageUpdate, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        result = await update_page(conn, request.state.tenant_id, page_id, body)
    if not result:
        raise HTTPException(status_code=404, detail="Page not found")
    return result


@router.delete("/pages/{page_id}", status_code=204)
async def remove_page(page_id: uuid.UUID, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        deleted = await delete_page(conn, request.state.tenant_id, page_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Page not found")


# ── Announcements ─────────────────────────────────────────────────────────────

@router.post("/announcements", response_model=AnnouncementResponse, status_code=201)
async def add_announcement(body: AnnouncementCreate, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await create_announcement(conn, request.state.tenant_id, body)


@router.get("/announcements", response_model=list[AnnouncementResponse])
async def get_announcements(request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await list_announcements(conn, request.state.tenant_id, active_only=False)


@router.put("/announcements/{ann_id}", response_model=AnnouncementResponse)
async def edit_announcement(ann_id: uuid.UUID, body: AnnouncementUpdate, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        result = await update_announcement(conn, request.state.tenant_id, ann_id, body)
    if not result:
        raise HTTPException(status_code=404, detail="Announcement not found")
    return result


@router.delete("/announcements/{ann_id}", status_code=204)
async def remove_announcement(ann_id: uuid.UUID, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        deleted = await delete_announcement(conn, request.state.tenant_id, ann_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Announcement not found")
