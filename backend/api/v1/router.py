from fastapi import APIRouter

from api.v1 import academic_years, attendance, auth, classes, fees, payments, staff, students, superadmin

router = APIRouter()
router.include_router(auth.router)
router.include_router(academic_years.router)
router.include_router(classes.router)
router.include_router(students.router)
router.include_router(staff.router)
router.include_router(attendance.router)
router.include_router(fees.router)
router.include_router(payments.router)
router.include_router(superadmin.router)
