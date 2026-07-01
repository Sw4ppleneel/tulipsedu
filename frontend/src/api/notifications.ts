import { request } from './client'

export interface AppNotification {
  id: string
  type: string
  title: string
  body: string
  ref: string | null
  read_at: string | null
  created_at: string
}

export interface UnreadCount {
  unread: number
}

// Module on/off flags from GET /me/features (allowlisted server-side; never the
// raw tenant feature_flags, which hold gateway secrets). Absent => enabled.
export interface FeatureFlags {
  attendance: boolean
  fees: boolean
  homework: boolean
  timetable: boolean
  exams: boolean
  cms: boolean
  section_label: string
}

export const notificationsApi = {
  list: () => request<AppNotification[]>('/notifications?limit=20'),
  unreadCount: () => request<UnreadCount>('/notifications/unread-count'),
  markRead: (id: string) =>
    request<void>(`/notifications/${id}/read`, { method: 'POST' }),
  markAllRead: () =>
    request<UnreadCount>('/notifications/read-all', { method: 'POST' }),
}

export const featuresApi = {
  get: () => request<FeatureFlags>('/me/features'),
}
