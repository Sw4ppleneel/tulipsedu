import re

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from core.rbac import require_roles

router = APIRouter(prefix="/settings", tags=["Settings"])

# UPI VPA, e.g. "school.name@okaxis"
_VPA_RE = re.compile(r"^[\w.\-]{2,256}@[a-zA-Z]{2,64}$")


class SchoolSettings(BaseModel):
    name: str
    upi_id: str | None = None


class UpiUpdate(BaseModel):
    upi_id: str | None = None


@router.get(
    "",
    response_model=SchoolSettings,
    dependencies=[Depends(require_roles("principal", "vice_principal", "accountant"))],
)
async def get_settings(request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT name, upi_id FROM tenants WHERE id = $1", request.state.tenant_id
        )
    return SchoolSettings(name=row["name"], upi_id=row["upi_id"])


@router.patch(
    "/upi",
    response_model=SchoolSettings,
    dependencies=[Depends(require_roles("principal"))],
)
async def set_upi(body: UpiUpdate, request: Request):
    upi = (body.upi_id or "").strip()
    if upi and not _VPA_RE.match(upi):
        raise HTTPException(status_code=422, detail="Invalid UPI ID — expected format name@bank")

    pool = request.app.state.pool
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "UPDATE tenants SET upi_id = $2 WHERE id = $1 RETURNING name, upi_id",
            request.state.tenant_id,
            upi or None,
        )
    return SchoolSettings(name=row["name"], upi_id=row["upi_id"])
