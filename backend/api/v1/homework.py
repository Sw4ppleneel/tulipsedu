from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from core.rbac import assert_in_scope, load_class_scope, require_roles
from models.homework import HomeworkCreate, HomeworkResponse, HomeworkUpdate
from services import homework as svc

router = APIRouter(
    prefix="/homework",
    tags=["Homework & Feed"],
    dependencies=[
        Depends(require_roles("principal", "vice_principal", "class_teacher", "teacher")),
        Depends(load_class_scope),
    ],
)


@router.post("", response_model=HomeworkResponse, status_code=201)
async def create_post(body: HomeworkCreate, request: Request):
    assert_in_scope(request, body.class_id, body.section_id)
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await svc.create_post(conn, request.state.tenant_id, body, posted_by=UUID(request.state.user_id))


@router.get("", response_model=list[HomeworkResponse])
async def list_posts(
    request: Request,
    class_id: Optional[UUID] = Query(None),
    section_id: Optional[UUID] = Query(None),
    post_type: Optional[str] = Query(None),
    academic_year_id: Optional[UUID] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await svc.list_posts(
            conn, request.state.tenant_id,
            class_id, section_id, post_type, academic_year_id, limit, offset,
        )


@router.patch("/{post_id}", response_model=HomeworkResponse)
async def update_post(post_id: UUID, body: HomeworkUpdate, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        result = await svc.update_post(conn, request.state.tenant_id, post_id, body, updated_by=UUID(request.state.user_id))
    if not result:
        raise HTTPException(404, "Post not found")
    return result


@router.delete("/{post_id}", status_code=204)
async def delete_post(post_id: UUID, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        ok = await svc.delete_post(conn, request.state.tenant_id, post_id, deleted_by=UUID(request.state.user_id))
    if not ok:
        raise HTTPException(404, "Post not found")
