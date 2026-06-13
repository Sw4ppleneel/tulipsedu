export interface AcademicYear {
  id: string
  tenant_id: string
  name: string
  start_date: string
  end_date: string
  is_current: boolean
  created_at: string
}

export interface Section {
  id: string
  tenant_id: string
  class_id: string
  name: string
}

export interface Class {
  id: string
  tenant_id: string
  name: string
  numeric_order: number | null
  sections: Section[]
}

export interface Student {
  id: string
  tenant_id: string
  academic_year_id: string
  class_id: string
  section_id: string
  admission_no: string
  roll_number: string
  first_name: string
  last_name: string
  date_of_birth: string
  gender: string
  parent_phone: string
  is_hosteler: boolean
  is_transport: boolean
  is_active: boolean
  created_at: string
  class_name: string | null
  section_name: string | null
  academic_year_name: string | null
}

export interface StudentListResponse {
  items: Student[]
  total: number
}

export interface StudentCreate {
  academic_year_id: string
  class_id: string
  section_id: string
  admission_no: string
  roll_number: string
  first_name: string
  last_name: string
  date_of_birth: string
  gender: string
  parent_phone: string
  is_hosteler: boolean
  is_transport?: boolean
}

export interface StudentFilters {
  academic_year_id?: string
  class_id?: string
  section_id?: string
  limit?: number
  offset?: number
}
