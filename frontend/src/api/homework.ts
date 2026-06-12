import { request } from './client'

export interface HomeworkPost {
  id: string
  tenant_id: string
  academic_year_id: string
  class_id: string
  section_id: string
  staff_id: string | null
  subject: string
  post_type: 'homework' | 'announcement' | 'resource'
  title: string
  description: string | null
  due_date: string | null
  attachment_urls: { name: string; url: string }[]
  is_active: boolean
  created_at: string
  class_name: string | null
  section_name: string | null
  staff_name: string | null
}

export interface HomeworkCreate {
  academic_year_id: string
  class_id: string
  section_id: string
  staff_id?: string
  subject: string
  post_type: 'homework' | 'announcement' | 'resource'
  title: string
  description?: string
  due_date?: string
}

export function listHomework(filters: {
  class_id?: string
  section_id?: string
  post_type?: string
  academic_year_id?: string
  limit?: number
  offset?: number
} = {}): Promise<HomeworkPost[]> {
  const p = new URLSearchParams()
  if (filters.class_id) p.set('class_id', filters.class_id)
  if (filters.section_id) p.set('section_id', filters.section_id)
  if (filters.post_type) p.set('post_type', filters.post_type)
  if (filters.academic_year_id) p.set('academic_year_id', filters.academic_year_id)
  if (filters.limit) p.set('limit', String(filters.limit))
  if (filters.offset) p.set('offset', String(filters.offset))
  const qs = p.toString()
  return request<HomeworkPost[]>(`/homework${qs ? `?${qs}` : ''}`)
}

export function createHomework(data: HomeworkCreate): Promise<HomeworkPost> {
  return request<HomeworkPost>('/homework', { method: 'POST', body: JSON.stringify(data) })
}

export function updateHomework(id: string, data: Partial<Pick<HomeworkCreate, 'title' | 'description' | 'due_date'>> & { is_active?: boolean }): Promise<HomeworkPost> {
  return request<HomeworkPost>(`/homework/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
}

export async function deleteHomework(id: string): Promise<void> {
  await request<void>(`/homework/${id}`, { method: 'DELETE' })
}
