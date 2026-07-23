import { request } from './client'

export interface ActivityLogEntry {
  id: number
  event_type: 'STUDENT_UPDATED' | 'FEE_WAIVED' | 'STUDENT_DISCOUNT_SET'
  created_at: string
  student_name: string | null
  actor_name: string
  summary: string
}

export function getActivityLog(limit = 100, offset = 0): Promise<ActivityLogEntry[]> {
  return request<ActivityLogEntry[]>(`/activity-log?limit=${limit}&offset=${offset}`)
}
