import { request } from './client'
import type {
  Payslip, PayrollRun, SalaryComponent, SalaryStructure, StaffPayslipSummary,
} from '../types/payroll'

// ── Salary structure (per staff) ──────────────────────────────────────────────
export function getSalary(staffId: string): Promise<SalaryStructure | null> {
  return request<SalaryStructure | null>(`/payroll/staff/${staffId}/salary`)
}

export function setSalary(staffId: string, data: {
  gross_salary: number
  components: SalaryComponent[]
  effective_from?: string
}): Promise<SalaryStructure> {
  return request<SalaryStructure>(`/payroll/staff/${staffId}/salary`, {
    method: 'PUT', body: JSON.stringify(data),
  })
}

export function listStaffPayslips(staffId: string): Promise<StaffPayslipSummary[]> {
  return request<StaffPayslipSummary[]>(`/payroll/staff/${staffId}/payslips`)
}

// ── Payroll runs ────────────────────────────────────────────────────────────--
export function listRuns(): Promise<PayrollRun[]> {
  return request<PayrollRun[]>('/payroll/runs')
}

export function createRun(period_month: number, period_year: number): Promise<PayrollRun> {
  return request<PayrollRun>('/payroll/runs', {
    method: 'POST', body: JSON.stringify({ period_month, period_year }),
  })
}

export function getRunPayslips(runId: string): Promise<Payslip[]> {
  return request<Payslip[]>(`/payroll/runs/${runId}/payslips`)
}

export function finalizeRun(runId: string): Promise<PayrollRun> {
  return request<PayrollRun>(`/payroll/runs/${runId}/finalize`, { method: 'POST' })
}

// ── Payslips ─────────────────────────────────────────────────────────────────
export function updatePayslip(payslipId: string, data: {
  allowances: { name: string; amount: number }[]
  deductions: { name: string; amount: number }[]
  note?: string
}): Promise<Payslip> {
  return request<Payslip>(`/payroll/payslips/${payslipId}`, {
    method: 'PATCH', body: JSON.stringify(data),
  })
}

// PDF is auth-gated, so fetch with the Bearer header then save the blob.
export async function downloadPayslipPdf(payslipId: string, filenameHint?: string): Promise<void> {
  const { getAuthState } = await import('./auth_state')
  const auth = getAuthState()
  const res = await fetch(`/api/v1/payroll/payslips/${payslipId}.pdf`, {
    headers: auth ? { Authorization: `Bearer ${auth.accessToken}`, 'X-Tenant-Slug': auth.tenantSlug } : {},
  })
  if (!res.ok) throw new Error('Could not generate payslip PDF')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `payslip-${filenameHint ?? payslipId}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
