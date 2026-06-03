from fastapi import APIRouter

from api.v1 import academic_years, auth, classes, students

router = APIRouter()
router.include_router(auth.router)
router.include_router(academic_years.router)
router.include_router(classes.router)
router.include_router(students.router)
