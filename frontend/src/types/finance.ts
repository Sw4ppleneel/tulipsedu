export interface FeeHead {
  id: string
  tenant_id: string
  name: string
  fee_type: 'monthly' | 'annual' | 'one_time'
  sort_order: number
  is_active: boolean
  created_at: string
}

export interface FeeSchedule {
  id: string
  tenant_id: string
  fee_head_id: string
  fee_head_name: string | null
  fee_type: string | null
  academic_year_id: string
  class_id: string | null
  class_name: string | null
  amount: string
  due_day_of_month: number
  created_at: string
}

export interface LedgerEntry {
  id: string
  tenant_id: string
  student_id: string
  fee_head_id: string
  fee_head_name: string | null
  fee_type: string | null
  academic_year_id: string
  period_month: number | null
  period_year: number
  amount_due: string
  status: 'pending' | 'paid' | 'waived'
  payment_id: string | null
  created_at: string
}

export interface StudentLedger {
  student_id: string
  student_name: string
  admission_no: string
  class_section: string
  pending: LedgerEntry[]
  paid: LedgerEntry[]
  total_pending: string
  total_paid: string
}

export interface OutstandingStudent {
  student_id: string
  student_name: string
  admission_no: string
  roll_number: string
  class_name: string
  section_name: string
  total_due: string
  pending_entries: number
}

export interface OutstandingReport {
  items: OutstandingStudent[]
  grand_total: string
  student_count: number
}

export interface BreakdownItem {
  description: string
  amount: string
}

export interface PaymentOrder {
  payment_id: string
  payment_ref: string
  gateway: string
  gateway_order_id: string | null
  payment_url: string | null
  qr_url: string | null
  amount: string
  currency: string
  status: string
  breakdown: BreakdownItem[]
  created_at: string
}

export interface FeePayment {
  id: string
  tenant_id: string
  student_id: string
  payment_ref: string
  gateway: string
  gateway_order_id: string | null
  gateway_payment_id: string | null
  amount: string
  status: string
  payment_method: string | null
  receipt_number: string | null
  paid_at: string | null
  created_at: string
}

export interface TenantRevenue {
  tenant_id: string
  school_name: string
  slug: string
  total_collected: string
  total_outstanding: string
  payment_count: number
}
