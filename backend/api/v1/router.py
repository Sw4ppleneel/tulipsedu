from fastapi import APIRouter

from api.v1 import (
    academic_years, attendance, auth, classes, cms_admin, cms_public,
    dashboard, exam, fees, homework, notifications, parent, parent_auth,
    payments, settings, staff, students, superadmin, timetable, uploads,
)

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
router.include_router(homework.router)
router.include_router(timetable.router)
router.include_router(exam.router)
router.include_router(dashboard.router)
router.include_router(parent_auth.router)
router.include_router(parent.router)
router.include_router(cms_admin.router)
router.include_router(cms_public.router)
router.include_router(uploads.router)
router.include_router(settings.router)
router.include_router(notifications.router)
