// Money fields arrive as strings (backend Decimal → JSON string), like types/finance.ts.

export interface SalaryComponent {
  name: string
  type: 'allowance' | 'deduction'
  amount: string
}

export interface SalaryStructure {
  id: string
  staff_id: string
  gross_salary: string
  components: SalaryComponent[]
  effective_from: string
  updated_at: string
}

export interface PayrollRun {
  id: string
  period_month: number
  period_year: number
  status: 'draft' | 'finalized'
  payslip_count: number
  total_net: string
  created_at: string
  finalized_at: string | null
}

export interface PayslipLine {
  name: string
  amount: string
}

export interface Payslip {
  id: string
  run_id: string
  staff_id: string
  staff_name: string
  employee_no: string
  designation: string | null
  gross_salary: string
  allowances: PayslipLine[]
  deductions: PayslipLine[]
  net_salary: string
  note: string | null
}

export interface StaffPayslipSummary {
  id: string
  gross_salary: string
  net_salary: string
  period_month: number
  period_year: number
  status: string
}
