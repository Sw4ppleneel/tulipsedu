import { request } from './client'

export interface ActivityLogEntry {
  id: number
  event_type: string
  category: string
  created_at: string
  // Whoever/whatever the action was about (a student or staff member) —
  // absent for events with no single subject (bulk imports, class-wide posts).
  subject_name: string | null
  actor_name: string
  summary: string
}

export function getActivityLog(limit = 100, offset = 0, category?: string): Promise<ActivityLogEntry[]> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (category) params.set('category', category)
  return request<ActivityLogEntry[]>(`/activity-log?${params}`)
}

export function getActivityLogCategories(): Promise<{ categories: string[] }> {
  return request<{ categories: string[] }>('/activity-log/categories')
}
