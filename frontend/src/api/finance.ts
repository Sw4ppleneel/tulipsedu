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
export function getOutstanding(params: {
  class_id?: string; section_id?: string; academic_year_id?: string
} = {}): Promise<OutstandingReport> {
  const qs = new URLSearchParams()
  if (params.class_id) qs.set('class_id', params.class_id)
  if (params.section_id) qs.set('section_id', params.section_id)
  if (params.academic_year_id) qs.set('academic_year_id', params.academic_year_id)
  return request<OutstandingReport>(`/fees/outstanding${qs.toString() ? `?${qs}` : ''}`)
}
export function sendReminders(studentIds: string[]): Promise<{ queued: number }> {
  return request('/fees/reminders', { method: 'POST', body: JSON.stringify(studentIds) })
}

// ── Payment Logs ────────────────────────────────────────────────────────────
export function getPaymentLogs(limit = 100): Promise<FeePayment[]> {
  return request<FeePayment[]>(`/fees/logs?limit=${limit}`)
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
