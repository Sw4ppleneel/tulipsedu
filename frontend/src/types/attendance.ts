export type AttendanceStatus = 'P' | 'A' | 'L'

export interface AttendanceSession {
  id: string
  tenant_id: string
  academic_year_id: string
  class_id: string
  section_id: string
  date: string
  marked_by: string
  submitted: boolean
  created_at: string
  class_name: string | null
  section_name: string | null
  academic_year_name: string | null
  marked_by_name: string | null
}

export interface AttendanceRecord {
  id: string
  tenant_id: string
  session_id: string
  student_id: string
  status: AttendanceStatus
  created_at: string
}

export interface SessionDetail {
  session: AttendanceSession
  records: AttendanceRecord[]
}

export interface AttendanceMark {
  student_id: string
  status: AttendanceStatus
}

export interface StudentAttendanceSummary {
  student_id: string
  first_name: string
  last_name: string
  roll_number: string
  admission_no: string
  total_sessions: number
  present: number
  absent: number
  late: number
  percentage: number
}

export interface AttendanceReport {
  class_id: string
  section_id: string
  academic_year_id: string
  from_date: string
  to_date: string
  total_sessions: number
  students: StudentAttendanceSummary[]
}
