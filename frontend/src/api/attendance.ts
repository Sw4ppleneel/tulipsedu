import { request } from './client'
import type {
  AttendanceMark,
  AttendanceReport,
  AttendanceSession,
  SessionDetail,
} from '../types/attendance'

export function openSession(data: {
  academic_year_id: string
  class_id: string
  section_id: string
  date: string
}): Promise<AttendanceSession> {
  return request<AttendanceSession>('/attendance/sessions', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function getSessionDetail(sessionId: string): Promise<SessionDetail> {
  return request<SessionDetail>(`/attendance/sessions/${sessionId}`)
}

export function markAttendance(
  sessionId: string,
  marks: AttendanceMark[],
): Promise<{ marked: number }> {
  return request<{ marked: number }>(`/attendance/sessions/${sessionId}/mark`, {
    method: 'POST',
    body: JSON.stringify({ marks }),
  })
}

export function submitSession(sessionId: string): Promise<AttendanceSession> {
  return request<AttendanceSession>(`/attendance/sessions/${sessionId}/submit`, {
    method: 'POST',
  })
}

export function getAttendanceReport(params: {
  academic_year_id: string
  class_id: string
  section_id: string
  from_date: string
  to_date: string
}): Promise<AttendanceReport> {
  const qs = new URLSearchParams(params as Record<string, string>)
  return request<AttendanceReport>(`/attendance/report?${qs}`)
}
