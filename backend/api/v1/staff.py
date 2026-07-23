from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile

from core.csv_export import csv_response, require_export_role
from core.rbac import require_roles
from models.staff import (
    AssignmentCreate,
    AssignmentResponse,
    StaffAccessResult,
    StaffCreate,
    StaffPasswordReset,
    StaffResponse,
    StaffRolesAssign,
    StaffUpdate,
)
from services.staff import (
    StaffError,
    StaffPasswordResetOutcome,
    create_assignment,
    create_staff,
    deactivate_staff,
    delete_assignment,
    export_all_staff,
    get_staff_member,
    import_staff,
    list_all_assignments,
    list_assignments,
    list_staff,
    reset_staff_password,
    set_staff_roles,
    update_staff,
)

# vice_principal may view staff but not manage contracts; writes are principal-only.
router = APIRouter(
    prefix="/staff",
    tags=["staff"],
    dependencies=[Depends(require_roles("principal", "vice_principal"))],
)

_principal_only = Depends(require_roles("principal"))


@router.post(
    "", response_model=StaffResponse, status_code=201, dependencies=[_principal_only]
)
async def add_staff(data: StaffCreate, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        try:
            return await create_staff(conn, request.state.tenant_id, data, created_by=UUID(request.state.user_id))
        except StaffError as e:
            raise HTTPException(status_code=409, detail=str(e))


# Export before /{staff_id} to prevent UUID matching /export.csv
@router.get("/export.csv")
async def export_staff_csv(request: Request):
    require_export_role(request)
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        staff = await export_all_staff(conn, request.state.tenant_id)

    headers = [
        "Employee No", "First Name", "Last Name", "Phone",
        "Designation", "Department", "Date of Joining", "Date of Birth",
        "Has System Login", "Active",
    ]
    rows = [
        [
            s.employee_no, s.first_name, s.last_name, s.phone_number,
            s.designation, s.department or "",
            str(s.date_of_joining), str(s.date_of_birth) if s.date_of_birth else "",
            "Yes" if s.user_id else "No",
            "Yes" if s.is_active else "No",
        ]
        for s in staff
    ]
    return csv_response(headers, rows, "staff.csv")


@router.get("", response_model=dict)
async def get_staff(
    request: Request,
    designation: Optional[str] = Query(None),
    is_active: Optional[bool] = Query(True),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        items, total = await list_staff(
            conn, request.state.tenant_id,
            designation=designation, is_active=is_active,
            limit=limit, offset=offset,
        )
    return {"items": items, "total": total}


@router.get("/assignments", dependencies=[Depends(require_roles("principal", "vice_principal"))])
async def all_assignments(
    request: Request,
    academic_year_id: Optional[UUID] = Query(None),
):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await list_all_assignments(conn, request.state.tenant_id, academic_year_id)


@router.get("/{staff_id}", response_model=StaffResponse)
async def get_one(staff_id: UUID, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        member = await get_staff_member(conn, request.state.tenant_id, staff_id)
    if not member:
        raise HTTPException(status_code=404, detail="Staff member not found")
    return member


@router.put("/{staff_id}", response_model=StaffResponse, dependencies=[_principal_only])
async def edit_staff(staff_id: UUID, data: StaffUpdate, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        member = await update_staff(conn, request.state.tenant_id, staff_id, data, updated_by=UUID(request.state.user_id))
    if not member:
        raise HTTPException(status_code=404, detail="Staff member not found")
    return member


@router.put("/{staff_id}/roles", response_model=StaffAccessResult, dependencies=[_principal_only])
async def assign_roles(staff_id: UUID, data: StaffRolesAssign, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        try:
            result = await set_staff_roles(conn, request.state.tenant_id, staff_id, data.roles, assigned_by=UUID(request.state.user_id))
        except StaffError as e:
            raise HTTPException(status_code=409, detail=str(e))
    if not result:
        raise HTTPException(status_code=404, detail="Staff member not found")
    return result


@router.put("/{staff_id}/password", dependencies=[_principal_only])
async def reset_password(staff_id: UUID, data: StaffPasswordReset, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        outcome = await reset_staff_password(conn, request.state.tenant_id, staff_id, data.new_password, reset_by=UUID(request.state.user_id))
    if outcome == StaffPasswordResetOutcome.NOT_FOUND:
        raise HTTPException(status_code=404, detail="Staff member not found")
    if outcome == StaffPasswordResetOutcome.NO_LOGIN:
        raise HTTPException(status_code=409, detail="This staff member has no login yet — assign a role first")
    return {"detail": "Password reset"}


@router.delete("/{staff_id}", status_code=204, dependencies=[_principal_only])
async def remove_staff(staff_id: UUID, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        deleted = await deactivate_staff(conn, request.state.tenant_id, staff_id, deactivated_by=UUID(request.state.user_id))
    if not deleted:
        raise HTTPException(status_code=404, detail="Staff member not found or already inactive")


@router.post(
    "/{staff_id}/assignments",
    response_model=AssignmentResponse,
    status_code=201,
    dependencies=[_principal_only],
)
async def assign_class(staff_id: UUID, data: AssignmentCreate, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        try:
            return await create_assignment(conn, request.state.tenant_id, staff_id, data, assigned_by=UUID(request.state.user_id))
        except StaffError as e:
            raise HTTPException(status_code=409, detail=str(e))


@router.get("/{staff_id}/assignments", response_model=list[AssignmentResponse])
async def get_assignments(staff_id: UUID, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await list_assignments(conn, request.state.tenant_id, staff_id)


@router.delete(
    "/{staff_id}/assignments/{assignment_id}",
    status_code=204,
    dependencies=[_principal_only],
)
async def remove_assignment(staff_id: UUID, assignment_id: UUID, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        ok = await delete_assignment(conn, request.state.tenant_id, staff_id, assignment_id, removed_by=UUID(request.state.user_id))
    if not ok:
        raise HTTPException(404, "Assignment not found")


@router.post("/import", dependencies=[_principal_only])
async def import_staff_xlsx(request: Request, file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Only .xlsx files are accepted")
    contents = await file.read()
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        try:
            return await import_staff(conn, request.state.tenant_id, contents, imported_by=UUID(request.state.user_id))
        except StaffError as e:
            raise HTTPException(status_code=422, detail=str(e))
