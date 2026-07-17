import { getAuthState } from './auth_state'
import { request } from './client'
import type {
  AcademicYear,
  Class,
  Section,
  Student,
  StudentCreate,
  StudentFilters,
  StudentListResponse,
} from '../types/student'

// ── Academic Years ──────────────────────────────────────────────────────────

export function listAcademicYears(): Promise<AcademicYear[]> {
  return request<AcademicYear[]>('/academic-years')
}

export function createAcademicYear(data: {
  name: string
  start_date: string
  end_date: string
}): Promise<AcademicYear> {
  return request<AcademicYear>('/academic-years', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function setCurrentYear(yearId: string): Promise<AcademicYear> {
  return request<AcademicYear>(`/academic-years/${yearId}/set-current`, { method: 'PATCH' })
}

export interface RolloverResult {
  archived_year: string
  new_current_year: string
  fee_rows_carried: number
  timetable_slots_cloned: number
}

export function rolloverYear(fromYearId: string, toYearId: string): Promise<RolloverResult> {
  return request<RolloverResult>(`/academic-years/${fromYearId}/rollover`, {
    method: 'POST',
    body: JSON.stringify({ to_year_id: toYearId }),
  })
}

// ── Classes ──────────────────────────────────────────────────────────────────

export function listClasses(): Promise<Class[]> {
  return request<Class[]>('/classes')
}

export function createClass(data: { name: string; numeric_order?: number }): Promise<Class> {
  return request<Class>('/classes', { method: 'POST', body: JSON.stringify(data) })
}

export function createSection(classId: string, data: { name: string }): Promise<Section> {
  return request<Section>(`/classes/${classId}/sections`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

// ── Students ─────────────────────────────────────────────────────────────────

export function listStudents(filters: StudentFilters = {}): Promise<StudentListResponse> {
  const params = new URLSearchParams()
  if (filters.academic_year_id) params.set('academic_year_id', filters.academic_year_id)
  if (filters.class_id) params.set('class_id', filters.class_id)
  if (filters.section_id) params.set('section_id', filters.section_id)
  if (filters.limit) params.set('limit', String(filters.limit))
  if (filters.offset) params.set('offset', String(filters.offset))
  const qs = params.toString()
  return request<StudentListResponse>(`/students${qs ? `?${qs}` : ''}`)
}

export function getStudent(id: string): Promise<Student> {
  return request<Student>(`/students/${id}`)
}

export function createStudent(data: StudentCreate): Promise<Student> {
  return request<Student>('/students', { method: 'POST', body: JSON.stringify(data) })
}

export function updateStudent(id: string, data: Partial<StudentCreate>): Promise<Student> {
  return request<Student>(`/students/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}

// Class-teacher-scoped: update just the registered parent phone (backs the
// parent-portal password rollout — the default password is the phone's last 4).
export function updateStudentContact(id: string, parentPhone: string): Promise<{ parent_phone: string }> {
  return request<{ parent_phone: string }>(`/students/${id}/contact`, {
    method: 'PATCH',
    body: JSON.stringify({ parent_phone: parentPhone }),
  })
}

// Class-teacher-scoped: staff override of the parent-portal password.
export function resetPortalPassword(id: string, newPassword: string): Promise<void> {
  return request<void>(`/students/${id}/portal-password`, {
    method: 'PUT',
    body: JSON.stringify({ new_password: newPassword }),
  })
}

export async function deactivateStudent(id: string): Promise<void> {
  const auth = getAuthState()
  await fetch(`/api/v1/students/${id}`, {
    method: 'DELETE',
    headers: auth
      ? { Authorization: `Bearer ${auth.accessToken}`, 'X-Tenant-Slug': auth.tenantSlug }
      : {},
  })
}
