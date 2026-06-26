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

// Build a Class[] (matching the students API shape) from the teacher's
// assigned class list so attendance and marks dropdowns can be filtered.
export interface ScopedClass {
  id: string
  name: string
  sections: { id: string; name: string }[]
}

export async function getAssignedClasses(): Promise<ScopedClass[]> {
  const dash = await teacherApi.dashboard()
  const map = new Map<string, ScopedClass>()
  for (const tc of dash.classes) {
    if (!map.has(tc.class_id)) {
      map.set(tc.class_id, { id: tc.class_id, name: tc.class_name, sections: [] })
    }
    const cls = map.get(tc.class_id)!
    if (!cls.sections.find(s => s.id === tc.section_id)) {
      cls.sections.push({ id: tc.section_id, name: tc.section_name })
    }
  }
  return Array.from(map.values())
}
