import { request } from './client'

export type AttendanceStatus = 'none' | 'draft' | 'submitted'

export interface TeacherClass {
  class_id: string
  section_id: string
  class_name: string
  section_name: string
  subject: string | null
  is_class_teacher: boolean
  attendance_today: AttendanceStatus
}

export interface TeacherHomework {
  id: string
  title: string
  subject: string | null
  post_type: string
  due_date: string | null
  created_at: string
  class_name: string
  section_name: string
}

export interface TeacherNotice {
  id: string
  title: string
  scope: string
  created_at: string
}

export interface TeacherExam {
  id: string
  name: string
  term_type: string
  start_date: string
  end_date: string
}

export interface TeacherDashboard {
  today: string
  classes: TeacherClass[]
  pending_attendance: TeacherClass[]
  recent_homework: TeacherHomework[]
  recent_notices: TeacherNotice[]
  upcoming_exams: TeacherExam[]
}

export const teacherApi = {
  dashboard: () => request<TeacherDashboard>('/teacher/dashboard'),
}
