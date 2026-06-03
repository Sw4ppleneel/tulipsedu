from fastapi import APIRouter

from api.v1 import auth

router = APIRouter()
router.include_router(auth.router)
