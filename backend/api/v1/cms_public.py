from fastapi import APIRouter, HTTPException, Request

from models.cms import AnnouncementResponse, PageResponse, SchoolInfo
from services.cms import get_page_by_slug, get_school_info, list_announcements, list_pages

router = APIRouter(prefix="/public", tags=["Public"])


@router.get("/school-info", response_model=SchoolInfo)
async def school_info(request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await get_school_info(conn, request.state.tenant_id)


@router.get("/pages", response_model=list[PageResponse])
async def public_pages(request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await list_pages(conn, request.state.tenant_id, published_only=True)


@router.get("/pages/{slug}", response_model=PageResponse)
async def public_page(slug: str, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        page = await get_page_by_slug(conn, request.state.tenant_id, slug)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    return page


@router.get("/announcements", response_model=list[AnnouncementResponse])
async def public_announcements(request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await list_announcements(conn, request.state.tenant_id, active_only=True)
