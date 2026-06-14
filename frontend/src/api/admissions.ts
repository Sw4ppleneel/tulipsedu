import { request } from './client'

export type AdmissionStatus = 'enquiry' | 'application' | 'docs_pending' | 'approved' | 'enrolled' | 'rejected'

export interface Admission {
  id: string
  status: AdmissionStatus
  applicant_name: string
  applicant_dob: string | null
  parent_name: string | null
  parent_phone: string | null
  notes: string | null
  class_name: string | null
  public_enquiry: boolean
  rejected_reason: string | null
  student_id: string | null
  created_at: string
  updated_at: string
}

export interface EnrolPayload {
  academic_year_id: string
  class_id: string
  section_id: string
  roll_number?: string
  adm_no?: string
}

export function listAdmissions(status?: string): Promise<Admission[]> {
  const p = new URLSearchParams()
  if (status) p.set('status', status)
  return request<Admission[]>(`/admissions?${p}`)
}

export function advanceStatus(id: string, status: string, reason?: string): Promise<Admission> {
  return request<Admission>(`/admissions/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, reason }),
  })
}

export function enrolStudent(id: string, payload: EnrolPayload): Promise<{ student_id: string; adm_no: string; status: string; message: string }> {
  return request(`/admissions/${id}/enrol`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
