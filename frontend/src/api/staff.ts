import { request } from './client'
import type { Assignment, Staff, StaffAccessResult, StaffCreate, StaffListResponse, StaffRole } from '../types/staff'

export function listStaff(params: { designation?: string; is_active?: boolean; limit?: number; offset?: number } = {}): Promise<StaffListResponse> {
  const qs = new URLSearchParams()
  if (params.designation) qs.set('designation', params.designation)
  if (params.is_active !== undefined) qs.set('is_active', String(params.is_active))
  if (params.limit) qs.set('limit', String(params.limit))
  if (params.offset) qs.set('offset', String(params.offset))
  return request<StaffListResponse>(`/staff${qs.toString() ? `?${qs}` : ''}`)
}

export function getStaff(id: string): Promise<Staff> {
  return request<Staff>(`/staff/${id}`)
}

export function createStaff(data: StaffCreate): Promise<Staff> {
  return request<Staff>('/staff', { method: 'POST', body: JSON.stringify(data) })
}

export function updateStaff(id: string, data: Partial<StaffCreate>): Promise<Staff> {
  return request<Staff>(`/staff/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}

export async function deactivateStaff(id: string): Promise<void> {
  await request(`/staff/${id}`, { method: 'DELETE' })
}

export function assignStaffRole(id: string, role: StaffRole): Promise<StaffAccessResult> {
  return request<StaffAccessResult>(`/staff/${id}/role`, { method: 'PUT', body: JSON.stringify({ role }) })
}

export function assignClass(staffId: string, data: {
  academic_year_id: string
  class_id: string
  section_id: string
  subject?: string
  is_class_teacher?: boolean
}): Promise<Assignment> {
  return request<Assignment>(`/staff/${staffId}/assignments`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function listAssignments(staffId: string): Promise<Assignment[]> {
  return request<Assignment[]>(`/staff/${staffId}/assignments`)
}

export function listAllAssignments(params?: { academic_year_id?: string }): Promise<Assignment[]> {
  const p = new URLSearchParams()
  if (params?.academic_year_id) p.set('academic_year_id', params.academic_year_id)
  return request<Assignment[]>(`/staff/assignments?${p}`)
}

export async function removeAssignment(staffId: string, assignmentId: string): Promise<void> {
  await request(`/staff/${staffId}/assignments/${assignmentId}`, { method: 'DELETE' })
}
