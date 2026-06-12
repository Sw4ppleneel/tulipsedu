from fastapi import APIRouter, HTTPException, Request

from config import settings
from models.parent import AdmissionLoginRequest, OTPRequest, OTPVerify, ParentTokenResponse
from services.parent import (
    ParentAuthError,
    login_by_admission_no,
    request_otp,
    verify_otp,
)

router = APIRouter(prefix="/parent/auth", tags=["Parent Auth"])


@router.post("/login", response_model=ParentTokenResponse)
async def parent_login(body: AdmissionLoginRequest, request: Request):
    """Phase 1 parent login: student's permanent admission number, no OTP."""
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        try:
            tokens = await login_by_admission_no(
                conn,
                request.state.tenant_id,
                request.state.tenant_slug,
                body.admission_no,
            )
        except ParentAuthError as e:
            raise HTTPException(status_code=401, detail=str(e))
    return ParentTokenResponse(**tokens)


@router.post("/request-otp", status_code=202)
async def request_parent_otp(body: OTPRequest, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        otp = await request_otp(conn, request.state.tenant_id, body.phone_number.strip())
    response: dict = {"detail": "OTP sent"}
    if settings.debug:
        response["dev_otp"] = otp
    return response


@router.post("/verify-otp", response_model=ParentTokenResponse)
async def verify_parent_otp(body: OTPVerify, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        try:
            tokens = await verify_otp(
                conn,
                request.state.tenant_id,
                request.state.tenant_slug,
                body.phone_number.strip(),
                body.otp.strip(),
            )
        except ParentAuthError as e:
            raise HTTPException(status_code=401, detail=str(e))
    return ParentTokenResponse(**tokens)
