import { request } from './client'
import type {
  FeeHead,
  FeePayment,
  FeeSchedule,
  OutstandingReport,
  PaymentOrder,
  StudentLedger,
  TenantRevenue,
} from '../types/finance'

// ── Fee Heads ──────────────────────────────────────────────────────────────
export function listFeeHeads(): Promise<FeeHead[]> {
  return request<FeeHead[]>('/fees/heads')
}
export function createFeeHead(data: { name: string; fee_type: string; sort_order?: number }): Promise<FeeHead> {
  return request<FeeHead>('/fees/heads', { method: 'POST', body: JSON.stringify(data) })
}
export function toggleFeeHead(id: string): Promise<FeeHead> {
  return request<FeeHead>(`/fees/heads/${id}/toggle`, { method: 'PATCH' })
}

// ── Fee Schedules ────────────────────────────────────────────────────────────
export function listSchedules(academic_year_id?: string): Promise<FeeSchedule[]> {
  const qs = academic_year_id ? `?academic_year_id=${academic_year_id}` : ''
  return request<FeeSchedule[]>(`/fees/schedules${qs}`)
}
export function upsertSchedule(data: {
  fee_head_id: string; academic_year_id: string;
  class_id?: string; amount: number; due_day_of_month?: number
}): Promise<FeeSchedule> {
  return request<FeeSchedule>('/fees/schedules', { method: 'POST', body: JSON.stringify(data) })
}

// ── Ledger ────────────────────────────────────────────────────────────────────
export function getStudentLedger(studentId: string): Promise<StudentLedger> {
  return request<StudentLedger>(`/fees/ledger?student_id=${studentId}`)
}
export function generateLedger(data: {
  academic_year_id: string;
  month_year_pairs: Array<{ month: number; year: number }>;
  include_annual: boolean
}): Promise<{ created: number; skipped: number; students: number }> {
  return request('/fees/generate-ledger', { method: 'POST', body: JSON.stringify(data) })
}

// ── Outstanding ───────────────────────────────────────────────────────────────
// No pagination UI on this report — request the platform's full tenant-size
// ceiling (5,000 students) so every student with dues is included, not just
// the first page. grand_total/student_count are computed server-side over
// all matching rows regardless of this limit.
export function getOutstanding(params: {
  class_id?: string; section_id?: string; academic_year_id?: string
} = {}): Promise<OutstandingReport> {
  const qs = new URLSearchParams()
  if (params.class_id) qs.set('class_id', params.class_id)
  if (params.section_id) qs.set('section_id', params.section_id)
  if (params.academic_year_id) qs.set('academic_year_id', params.academic_year_id)
  qs.set('limit', '5000')
  return request<OutstandingReport>(`/fees/outstanding?${qs}`)
}
export function sendReminders(studentIds: string[]): Promise<{ queued: number }> {
  return request('/fees/reminders', { method: 'POST', body: JSON.stringify(studentIds) })
}

// ── Payment Logs ────────────────────────────────────────────────────────────
export function getPaymentLogs(limit = 100): Promise<FeePayment[]> {
  return request<FeePayment[]>(`/fees/logs?limit=${limit}`)
}

// ── Receipt HTML view ─────────────────────────────────────────────────────────
// The receipt endpoint is auth-gated, so window.open / <a href> would 401.
// Fetch with auth, create a blob URL, open in a new tab.
export async function openReceiptHtml(paymentId: string): Promise<void> {
  const { getAuthState } = await import('./auth_state')
  const auth = getAuthState()
  const res = await fetch(`/api/v1/payments/${paymentId}/receipt`, {
    headers: auth ? { Authorization: `Bearer ${auth.accessToken}`, 'X-Tenant-Slug': auth.tenantSlug } : {},
  })
  if (!res.ok) throw new Error('Could not load receipt')
  const html = await res.text()
  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const tab = window.open(url, '_blank')
  if (!tab) throw new Error('Popup blocked — please allow popups for this site')
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

// ── CSV exports ───────────────────────────────────────────────────────────────
async function _downloadCsv(url: string, filename: string): Promise<void> {
  const { getAuthState } = await import('./auth_state')
  const auth = getAuthState()
  const res = await fetch(url, {
    headers: auth ? { Authorization: `Bearer ${auth.accessToken}`, 'X-Tenant-Slug': auth.tenantSlug } : {},
  })
  if (!res.ok) throw new Error('Could not export CSV')
  const blob = await res.blob()
  const blobUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(blobUrl)
}

export function downloadDefaultersCsv(params: { academic_year_id?: string; class_id?: string } = {}): Promise<void> {
  const p = new URLSearchParams()
  if (params.academic_year_id) p.set('academic_year_id', params.academic_year_id)
  if (params.class_id) p.set('class_id', params.class_id)
  p.set('format', 'csv')
  return _downloadCsv(`/api/v1/fees/defaulters?${p}`, 'defaulters.csv')
}

// ── Receipt PDF download ──────────────────────────────────────────────────────
// The PDF endpoint is auth-gated (Bearer header), so a plain <a href> would 401.
// Fetch with the auth header, then save the blob as a file the staff can forward.
export async function downloadReceiptPdf(paymentId: string, receiptNumber?: string): Promise<void> {
  const { getAuthState } = await import('./auth_state')
  const auth = getAuthState()
  const res = await fetch(`/api/v1/payments/${paymentId}/receipt.pdf`, {
    headers: auth ? { Authorization: `Bearer ${auth.accessToken}`, 'X-Tenant-Slug': auth.tenantSlug } : {},
  })
  if (!res.ok) throw new Error('Could not generate receipt PDF')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `receipt-${receiptNumber ?? paymentId}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// ── Payments ─────────────────────────────────────────────────────────────────
export function createOrder(data: {
  student_id: string; ledger_ids: string[]; gateway: string
}): Promise<PaymentOrder> {
  return request<PaymentOrder>('/payments/create-order', { method: 'POST', body: JSON.stringify(data) })
}
export function pollPayment(paymentId: string): Promise<FeePayment> {
  return request<FeePayment>(`/payments/${paymentId}`)
}
export function mockComplete(paymentId: string): Promise<FeePayment> {
  return request<FeePayment>(`/payments/${paymentId}/mock-complete`, { method: 'POST' })
}

// ── Superadmin ────────────────────────────────────────────────────────────────
export function getSuperadminRevenue(): Promise<TenantRevenue[]> {
  return request<TenantRevenue[]>('/superadmin/revenue')
}
export function getSuperadminPayments(limit = 200): Promise<Record<string, unknown>[]> {
  return request<Record<string, unknown>[]>(`/superadmin/payments?limit=${limit}`)
}

// ── Parent payment verification (accountant) ─────────────────────────────────
export interface PendingPayment {
  id: string
  amount: number
  reference_no: string | null
  first_name: string
  last_name: string
  admission_no: string
  class_name: string
  section_name: string
  periods: string
  created_at: string
}

export function listPendingPayments(): Promise<PendingPayment[]> {
  return request<PendingPayment[]>('/fees/payments/pending')
}

export function approvePayment(id: string): Promise<{ status: string; receipt_number: string }> {
  return request(`/fees/payments/${id}/approve`, { method: 'POST' })
}

export function rejectPayment(id: string, reason: string): Promise<void> {
  return request<void>(`/fees/payments/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) })
}

// ── Office (offline) fee collection: cash/cheque/upi/bank — marks paid + receipt ──
export function collectOffline(data: {
  student_id: string
  ledger_ids: string[]
  method: 'cash' | 'cheque' | 'upi' | 'bank_transfer' | 'card'
  reference_no?: string
}): Promise<{ payment_id: string; receipt_number: string }> {
  return request('/fees/collect', { method: 'POST', body: JSON.stringify(data) })
}

// Waive selected unpaid fees (mandatory reason). A revenue decision, not a
// payment — no receipt, never counted as collected.
export function waiveFees(data: {
  student_id: string
  ledger_ids: string[]
  reason: string
}): Promise<{ waived: number; total: number }> {
  return request('/fees/waive', { method: 'POST', body: JSON.stringify(data) })
}

// ── Student fee discounts (sibling concessions etc.) ─────────────────────────

export interface StudentDiscount {
  fee_head_id: string
  fee_head_name: string
  percentage: number
  reason: string
}

export function getStudentDiscounts(studentId: string): Promise<StudentDiscount[]> {
  return request(`/fees/discounts?student_id=${studentId}`)
}

export function setStudentDiscounts(data: {
  student_id: string
  items: { fee_head_id: string; percentage: number }[]
  reason?: string
}): Promise<{ discounts: number; ledger_rows_updated: number }> {
  return request('/fees/discounts', { method: 'PUT', body: JSON.stringify(data) })
}


export interface DefaulterEntry { id: string; fee_head_name: string; period: string; amount_due: number; due_date: string | null }
export interface Defaulter { student_id: string; admission_no: string; student_name: string; roll_number: string; class_name: string; section_name: string; total_overdue: number; entries: DefaulterEntry[] }
export interface DefaultersResponse { total_students: number; defaulters: Defaulter[] }
export interface RecoveryClass { class_id: string; class_name: string; collected: number; expected: number; rate_pct: number }
export interface RecoveryResponse { school_wide: { collected: number; expected: number; rate_pct: number }; by_class: RecoveryClass[] }

export function getDefaulters(params?: { class_id?: string; section_id?: string; academic_year_id?: string }): Promise<DefaultersResponse> {
  const p = new URLSearchParams()
  if (params?.class_id) p.set('class_id', params.class_id)
  if (params?.section_id) p.set('section_id', params.section_id)
  if (params?.academic_year_id) p.set('academic_year_id', params.academic_year_id)
  return request<DefaultersResponse>(`/fees/defaulters?${p}`)
}

export function getFeeRecovery(params?: { academic_year_id?: string }): Promise<RecoveryResponse> {
  const p = new URLSearchParams()
  if (params?.academic_year_id) p.set('academic_year_id', params.academic_year_id)
  return request<RecoveryResponse>(`/fees/recovery?${p}`)
}
