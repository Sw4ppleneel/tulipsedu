from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response

from core.rbac import assert_in_scope, load_class_scope, require_roles
from models.exam import (
    BulkMarkRequest,
    ComponentMarksGrid,
    ConfigureComponentsRequest,
    ConsolidatedResult,
    ExamComponentResponse,
    ExamSubjectCreate,
    ExamSubjectResponse,
    ExamTermCreate,
    ExamTermResponse,
    MarkEntryResponse,
    MarksConfigCreate,
    MarksConfigResponse,
    SaveComponentMarksRequest,
    TermResultSheet,
    TermStatusRequest,
)
from services import exam as svc
from services.exam import ExamError
from services.report_card import build_report_card_context
from services.report_card_pdf import render_report_card_pdf

# All teaching roles may read exam config and enter marks; exam setup (subjects,
# terms, config, publish) is restricted to principal/vice_principal.
router = APIRouter(
    prefix="/exams",
    tags=["Examinations"],
    dependencies=[
        Depends(require_roles("principal", "vice_principal", "class_teacher", "teacher")),
    ],
)

_setup = Depends(require_roles("principal", "vice_principal"))


# ── Subjects ──────────────────────────────────────────────────────────────────

@router.post(
    "/subjects",
    response_model=ExamSubjectResponse,
    status_code=201,
    dependencies=[_setup],
)
async def create_subject(body: ExamSubjectCreate, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        try:
            return await svc.create_subject(conn, request.state.tenant_id, body)
        except ExamError as e:
            raise HTTPException(409, str(e))


@router.get("/subjects", response_model=list[ExamSubjectResponse])
async def list_subjects(
    request: Request,
    academic_year_id: Optional[UUID] = Query(None),
    class_id: Optional[UUID] = Query(None),
    section_id: Optional[UUID] = Query(None),
):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await svc.list_subjects(conn, request.state.tenant_id, academic_year_id, class_id, section_id)


@router.delete("/subjects/{subject_id}", status_code=204, dependencies=[_setup])
async def remove_subject(subject_id: UUID, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        removed = await svc.deactivate_subject(conn, request.state.tenant_id, subject_id)
    if not removed:
        raise HTTPException(404, "Subject not found")


# ── Terms ─────────────────────────────────────────────────────────────────────

@router.post(
    "/terms", response_model=ExamTermResponse, status_code=201, dependencies=[_setup]
)
async def create_term(body: ExamTermCreate, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        try:
            return await svc.create_term(conn, request.state.tenant_id, body)
        except ExamError as e:
            raise HTTPException(409, str(e))


@router.get("/terms", response_model=list[ExamTermResponse])
async def list_terms(
    request: Request,
    academic_year_id: Optional[UUID] = Query(None),
):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await svc.list_terms(conn, request.state.tenant_id, academic_year_id)


@router.patch(
    "/terms/{term_id}/publish", response_model=ExamTermResponse, dependencies=[_setup]
)
async def publish_term(
    term_id: UUID,
    request: Request,
    publish: bool = Query(True),
):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        result = await svc.publish_term(conn, request.state.tenant_id, term_id, publish)
    if not result:
        raise HTTPException(404, "Exam term not found")
    return result


@router.post(
    "/terms/{term_id}/status", response_model=ExamTermResponse, dependencies=[_setup]
)
async def transition_term_status(term_id: UUID, body: TermStatusRequest, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        try:
            return await svc.transition_term_status(
                conn, request.state.tenant_id, term_id, body.status
            )
        except svc.ExamError as e:
            raise HTTPException(409, str(e))


# ── Marks Config ──────────────────────────────────────────────────────────────

@router.put("/marks-config", response_model=MarksConfigResponse, dependencies=[_setup])
async def upsert_marks_config(body: MarksConfigCreate, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await svc.upsert_marks_config(conn, request.state.tenant_id, body)


@router.get("/marks-config", response_model=list[MarksConfigResponse])
async def list_marks_config(
    request: Request,
    exam_term_id: UUID = Query(...),
):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await svc.list_marks_config(conn, request.state.tenant_id, exam_term_id)


# ── Components (term × subject breakdown) ─────────────────────────────────────

@router.put("/components", response_model=list[ExamComponentResponse], dependencies=[_setup])
async def configure_components(body: ConfigureComponentsRequest, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        try:
            return await svc.configure_components(conn, request.state.tenant_id, body)
        except ExamError as e:
            raise HTTPException(422, str(e))


@router.get("/components", response_model=list[ExamComponentResponse])
async def list_components(
    request: Request,
    exam_term_id: UUID = Query(...),
    exam_subject_id: UUID = Query(...),
):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await svc.list_components(
            conn, request.state.tenant_id, exam_term_id, exam_subject_id
        )


@router.get("/component-marks", response_model=ComponentMarksGrid)
async def component_marks_grid(
    request: Request,
    exam_term_id: UUID = Query(...),
    exam_subject_id: UUID = Query(...),
    class_id: UUID = Query(...),
    section_id: UUID = Query(...),
):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await svc.get_component_marks_grid(
            conn, request.state.tenant_id, exam_term_id, exam_subject_id, class_id, section_id
        )


@router.post("/component-marks", status_code=200)
async def save_component_marks(body: SaveComponentMarksRequest, request: Request):
    await load_class_scope(request)
    if body.class_id and body.section_id:
        assert_in_scope(request, body.class_id, body.section_id)
    pool = request.app.state.pool
    user_id = UUID(request.state.user_id)
    async with pool.acquire() as conn:
        try:
            return await svc.save_component_marks(conn, request.state.tenant_id, user_id, body)
        except svc.ExamError as e:
            raise HTTPException(409, str(e))


# ── Mark Entry ────────────────────────────────────────────────────────────────

@router.post("/marks", status_code=200)
async def save_marks(body: BulkMarkRequest, request: Request):
    await load_class_scope(request)
    if body.class_id and body.section_id:
        assert_in_scope(request, body.class_id, body.section_id)
    pool = request.app.state.pool
    user_id = UUID(request.state.user_id)
    async with pool.acquire() as conn:
        try:
            return await svc.save_marks(conn, request.state.tenant_id, user_id, body)
        except svc.ExamError as e:
            raise HTTPException(409, str(e))


@router.get("/marks", response_model=list[MarkEntryResponse])
async def get_marks(
    request: Request,
    exam_term_id: UUID = Query(...),
    exam_subject_id: UUID = Query(...),
    class_id: UUID = Query(...),
    section_id: UUID = Query(...),
):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await svc.get_marks_for_term_subject(
            conn, request.state.tenant_id, exam_term_id, exam_subject_id, class_id, section_id
        )


# ── Results ───────────────────────────────────────────────────────────────────

@router.get("/results/term", response_model=TermResultSheet)
async def term_results(
    request: Request,
    exam_term_id: UUID = Query(...),
    class_id: UUID = Query(...),
    section_id: UUID = Query(...),
):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        try:
            return await svc.compute_term_results(
                conn, request.state.tenant_id, exam_term_id, class_id, section_id
            )
        except ExamError as e:
            raise HTTPException(404, str(e))


@router.get("/results/report-card.pdf")
async def report_card_pdf(
    request: Request,
    exam_term_id: UUID = Query(...),
    student_id: UUID = Query(...),
):
    """Downloadable report-card PDF for one student in a term (staff may download
    regardless of publish state — to print/forward)."""
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        ctx = await build_report_card_context(
            conn, request.state.tenant_id, exam_term_id, student_id, require_published=False
        )
    if not ctx:
        raise HTTPException(404, "No results found for this student in this term")
    pdf = render_report_card_pdf(ctx)
    filename = f"report-card-{ctx['admission_no']}-{ctx['term_name']}.pdf".replace(" ", "_")
    return Response(
        content=pdf, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/results/consolidated", response_model=list[ConsolidatedResult])
async def consolidated_results(
    request: Request,
    academic_year_id: UUID = Query(...),
    class_id: UUID = Query(...),
    section_id: UUID = Query(...),
):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        return await svc.compute_consolidated_results(
            conn, request.state.tenant_id, academic_year_id, class_id, section_id
        )


@router.post("/import", dependencies=[_setup])
async def import_exam_setup_xlsx(
    request: Request,
    academic_year_id: UUID = Query(...),
    file: UploadFile = File(...),
):
    """
    Two-sheet xlsx — Sheet 'Subjects' and Sheet 'Terms'.
    See req_doc_formats/exam_setup.xlsx for the template.
    """
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Only .xlsx files are accepted")
    contents = await file.read()
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        try:
            return await svc.import_exam_setup(
                conn, request.state.tenant_id, academic_year_id, contents
            )
        except ExamError as e:
            raise HTTPException(status_code=422, detail=str(e))
