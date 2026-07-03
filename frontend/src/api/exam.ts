import { request } from './client'

export interface ExamSubject {
  id: string
  tenant_id: string
  academic_year_id: string
  class_id: string
  section_id: string | null
  name: string
  subject_code: string | null
  sort_order: number
  is_active: boolean
  created_at: string
}

export interface ExamTerm {
  id: string
  tenant_id: string
  academic_year_id: string
  name: string
  term_type: string
  start_date: string | null
  end_date: string | null
  is_published: boolean
  status: string  // draft | marks_open | locked | published
  sort_order: number
  created_at: string
}

export interface MarksConfig {
  id: string
  tenant_id: string
  exam_term_id: string
  exam_subject_id: string
  subject_name: string | null
  max_marks: string
  passing_marks: string
  weightage: string
}

export interface MarkEntry {
  id: string
  student_id: string
  exam_term_id: string
  exam_subject_id: string
  marks_obtained: string | null
  is_absent: boolean
  remarks: string | null
  entered_by: string | null
}

export interface SubjectResult {
  subject_id: string
  subject_name: string
  max_marks: string
  marks_obtained: string | null
  is_absent: boolean
  percentage: number | null
  grade: string
  passed: boolean
}

export interface StudentTermResult {
  student_id: string
  roll_number: string
  admission_no: string
  student_name: string
  subjects: SubjectResult[]
  total_obtained: string
  total_max: string
  percentage: number | null
  grade: string
  passed: boolean
}

export interface TermResultSheet {
  exam_term_id: string
  exam_term_name: string
  class_id: string
  section_id: string
  results: StudentTermResult[]
}

export function listSubjects(params: { academic_year_id?: string; class_id?: string } = {}): Promise<ExamSubject[]> {
  const p = new URLSearchParams()
  if (params.academic_year_id) p.set('academic_year_id', params.academic_year_id)
  if (params.class_id) p.set('class_id', params.class_id)
  return request<ExamSubject[]>(`/exams/subjects?${p}`)
}

export function createSubject(data: {
  academic_year_id: string
  class_id: string
  section_id?: string
  name: string
  subject_code?: string
  sort_order?: number
}): Promise<ExamSubject> {
  return request<ExamSubject>('/exams/subjects', { method: 'POST', body: JSON.stringify(data) })
}

export function deleteSubject(id: string): Promise<void> {
  return request<void>(`/exams/subjects/${id}`, { method: 'DELETE' })
}

export function listTerms(params: { academic_year_id?: string } = {}): Promise<ExamTerm[]> {
  const p = new URLSearchParams()
  if (params.academic_year_id) p.set('academic_year_id', params.academic_year_id)
  return request<ExamTerm[]>(`/exams/terms?${p}`)
}

export function createTerm(data: {
  academic_year_id: string; name: string; term_type?: string; sort_order?: number
}): Promise<ExamTerm> {
  return request<ExamTerm>('/exams/terms', { method: 'POST', body: JSON.stringify(data) })
}

export function listMarksConfig(exam_term_id: string): Promise<MarksConfig[]> {
  return request<MarksConfig[]>(`/exams/marks-config?exam_term_id=${exam_term_id}`)
}

export function getMarks(params: {
  exam_term_id: string
  exam_subject_id: string
  class_id: string
  section_id: string
}): Promise<MarkEntry[]> {
  const p = new URLSearchParams({
    exam_term_id: params.exam_term_id,
    exam_subject_id: params.exam_subject_id,
    class_id: params.class_id,
    section_id: params.section_id,
  })
  return request<MarkEntry[]>(`/exams/marks?${p}`)
}

export function saveMarks(data: {
  exam_term_id: string
  class_id?: string
  section_id?: string
  entries: { student_id: string; exam_subject_id: string; marks_obtained?: number | null; is_absent: boolean; remarks?: string }[]
}): Promise<{ saved: number }> {
  return request<{ saved: number }>('/exams/marks', { method: 'POST', body: JSON.stringify(data) })
}

export function getTermResults(params: {
  exam_term_id: string
  class_id: string
  section_id: string
}): Promise<TermResultSheet> {
  const p = new URLSearchParams({
    exam_term_id: params.exam_term_id,
    class_id: params.class_id,
    section_id: params.section_id,
  })
  return request<TermResultSheet>(`/exams/results/term?${p}`)
}

// Report-card PDF is auth-gated, so fetch with the Bearer header then save the blob.
export async function downloadReportCard(examTermId: string, studentId: string, filenameHint?: string): Promise<void> {
  const { getAuthState } = await import('./auth_state')
  const auth = getAuthState()
  const res = await fetch(`/api/v1/exams/results/report-card.pdf?exam_term_id=${examTermId}&student_id=${studentId}`, {
    headers: auth ? { Authorization: `Bearer ${auth.accessToken}`, 'X-Tenant-Slug': auth.tenantSlug } : {},
  })
  if (!res.ok) throw new Error('Could not download report card')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `report-card-${filenameHint ?? studentId}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// ── Exam Components ────────────────────────────────────────────────────────────

export interface ExamComponent {
  id: string
  name: string
  max_marks: string
  weightage: string
  sort_order: number
}

export interface StudentComponentRow {
  student_id: string
  roll_number: string
  student_name: string
  marks: Record<string, number | null>  // keyed by component id
  is_absent: boolean
  total: number | null
}

export interface ComponentMarksGrid {
  exam_term_id: string
  exam_subject_id: string
  components: ExamComponent[]
  total_max: string
  students: StudentComponentRow[]
}

export function listComponents(exam_term_id: string, exam_subject_id: string): Promise<ExamComponent[]> {
  const p = new URLSearchParams({ exam_term_id, exam_subject_id })
  return request<ExamComponent[]>(`/exams/components?${p}`)
}

export function configureComponents(data: {
  exam_term_id: string
  exam_subject_id: string
  components: { name: string; max_marks: number; weightage: number; sort_order: number }[]
}): Promise<ExamComponent[]> {
  return request<ExamComponent[]>('/exams/components', { method: 'PUT', body: JSON.stringify(data) })
}

export function getComponentGrid(params: {
  exam_term_id: string; exam_subject_id: string; class_id: string; section_id: string
}): Promise<ComponentMarksGrid> {
  const p = new URLSearchParams(params)
  return request<ComponentMarksGrid>(`/exams/component-marks?${p}`)
}

export function saveComponentMarks(data: {
  exam_term_id: string
  exam_subject_id: string
  class_id?: string
  section_id?: string
  entries: { student_id: string; exam_component_id: string; marks_obtained?: number | null; is_absent: boolean }[]
}): Promise<{ saved: number }> {
  return request<{ saved: number }>('/exams/component-marks', { method: 'POST', body: JSON.stringify(data) })
}

export function transitionTermStatus(termId: string, status: string): Promise<ExamTerm> {
  return request<ExamTerm>(`/exams/terms/${termId}/status`, { method: 'POST', body: JSON.stringify({ status }) })
}
