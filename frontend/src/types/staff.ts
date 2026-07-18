export interface Staff {
  id: string
  tenant_id: string
  user_id: string | null
  employee_no: string
  first_name: string
  last_name: string
  phone_number: string
  designation: string
  department: string | null
  date_of_joining: string
  date_of_birth: string | null
  is_active: boolean
  created_at: string
  role: string | null
}

export interface StaffListResponse {
  items: Staff[]
  total: number
}

export interface StaffCreate {
  employee_no: string
  first_name: string
  last_name: string
  phone_number: string
  designation: string
  department?: string
  date_of_joining: string
  date_of_birth?: string
  user_id?: string
}

export type StaffRole = 'principal' | 'vice_principal' | 'class_teacher' | 'teacher' | 'accountant'

export const STAFF_ROLES: StaffRole[] = ['principal', 'vice_principal', 'class_teacher', 'teacher', 'accountant']

export interface StaffAccessResult {
  staff: Staff
  login_created: boolean
  generated_password: string | null
}

export interface Assignment {
  id: string
  tenant_id: string
  staff_id: string
  academic_year_id: string
  class_id: string
  section_id: string
  subject: string | null
  is_class_teacher: boolean
  created_at: string
  class_name: string | null
  section_name: string | null
  academic_year_name: string | null
  // present only in the all-assignments endpoint
  staff_name?: string
  designation?: string | null
}
