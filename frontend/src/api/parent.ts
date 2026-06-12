import { getAuthState } from './auth_state'

const BASE = '/api/v1'

async function parentRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const auth = getAuthState()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(auth
      ? { Authorization: `Bearer ${auth.accessToken}`, 'X-Tenant-Slug': auth.tenantSlug }
      : {}),
  }
  const res = await fetch(`${BASE}${path}`, { ...options, headers })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: 'Request failed' }))
    throw new Error((body as { detail?: string }).detail ?? 'Request failed')
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export interface OTPRequestResponse {
  detail: string
  dev_otp?: string
}

export interface ParentTokenResponse {
  access_token: string
  refresh_token: string
  student_id?: string
  student_name?: string
}

export interface LinkedStudent {
  id: string
  first_name: string
  last_name: string
  admission_no: string
  roll_number: number
  class_name: string
  section_name: string
  class_id: string
  section_id: string
  academic_year_id: string
  relationship: string
}

export interface AttendanceSummary {
  total_sessions: number
  present: number
  absent: number
  late: number
  percentage: number
}

export interface FeeAssignment {
  structure_name: string
  total_amount: number
  paid_amount: number
  balance: number
  status: string
}

export interface RecentPayment {
  amount: number
  payment_method: string
  reference_no: string | null
  created_at: string
}

export interface FeeSummary {
  assignments: FeeAssignment[]
  recent_payments: RecentPayment[]
  total_balance: number
}

export interface HomeworkItem {
  id: string
  subject: string
  post_type: string
  title: string
  description: string | null
  due_date: string | null
  created_at: string
}

export interface StudentSummary {
  student: LinkedStudent
  attendance: AttendanceSummary
  fees: FeeSummary
  recent_homework: HomeworkItem[]
  school_name: string
  school_upi_id: string | null
}

export function requestOtp(tenantSlug: string, phone: string): Promise<OTPRequestResponse> {
  return fetch(`${BASE}/parent/auth/request-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Slug': tenantSlug },
    body: JSON.stringify({ phone_number: phone }),
  }).then(async res => {
    const body = await res.json()
    if (!res.ok) throw new Error(body.detail ?? 'Request failed')
    return body as OTPRequestResponse
  })
}

export function verifyOtp(tenantSlug: string, phone: string, otp: string): Promise<ParentTokenResponse> {
  return fetch(`${BASE}/parent/auth/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Slug': tenantSlug },
    body: JSON.stringify({ phone_number: phone, otp }),
  }).then(async res => {
    const body = await res.json()
    if (!res.ok) throw new Error(body.detail ?? 'Verification failed')
    return body as ParentTokenResponse
  })
}

export function loginByAdmissionNo(tenantSlug: string, admissionNo: string): Promise<ParentTokenResponse> {
  return fetch(`${BASE}/parent/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Slug': tenantSlug },
    body: JSON.stringify({ admission_no: admissionNo }),
  }).then(async res => {
    const body = await res.json()
    if (!res.ok) throw new Error(body.detail ?? 'Login failed')
    return body as ParentTokenResponse
  })
}

export interface FeeLedgerEntry {
  id: string
  fee_head_name: string
  period_month: number | null
  period_year: number
  amount_due: number
  status: string
}

export function listMyStudents(): Promise<LinkedStudent[]> {
  return parentRequest<LinkedStudent[]>('/parent/students')
}

export function getStudentSummary(studentId: string): Promise<StudentSummary> {
  return parentRequest<StudentSummary>(`/parent/students/${studentId}/summary`)
}

export function getStudentLedger(studentId: string): Promise<FeeLedgerEntry[]> {
  return parentRequest<FeeLedgerEntry[]>(`/parent/students/${studentId}/ledger`)
}
