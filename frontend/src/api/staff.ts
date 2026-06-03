import { request } from './client'
import type { Assignment, Staff, StaffCreate, StaffListResponse } from '../types/staff'

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
