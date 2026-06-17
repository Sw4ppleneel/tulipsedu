import { request } from './client'

export interface CmsPage {
  id: string
  tenant_id: string
  slug: string
  title: string
  content_html: string
  meta_description: string | null
  is_published: boolean
  sort_order: number
  updated_at: string
  created_at: string
}

export interface CmsAnnouncement {
  id: string
  tenant_id: string
  title: string
  body: string
  is_published: boolean
  published_at: string | null
  expires_at: string | null
  created_at: string
}

export interface PageCreate {
  slug: string
  title: string
  content_html?: string
  meta_description?: string
  is_published?: boolean
  sort_order?: number
}

export interface AnnouncementCreate {
  title: string
  body: string
  is_published?: boolean
  published_at?: string
  expires_at?: string
}

export interface SchoolInfo {
  name: string
  slug: string
}

// Resolve tenant slug from subdomain (prod) or ?school= override (local dev).
export function publicSlug(): string {
  const params = new URLSearchParams(window.location.search)
  const override = params.get('school')
  if (override) return override
  const parts = window.location.hostname.split('.')
  return parts.length > 2 ? parts[0] : ''
}

async function publicGet<T>(path: string): Promise<T> {
  const slug = publicSlug()
  const headers: Record<string, string> = {}
  if (slug) headers['X-Tenant-Slug'] = slug
  const res = await fetch(`/api/v1${path}`, { headers })
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.json() as Promise<T>
}

async function publicPost<T>(path: string, body: unknown): Promise<T> {
  const slug = publicSlug()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (slug) headers['X-Tenant-Slug'] = slug
  const res = await fetch(`/api/v1${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.json() as Promise<T>
}

// Public (unauthenticated, tenant-scoped)
export const cmsPublic = {
  schoolInfo: () => publicGet<SchoolInfo>('/public/school-info'),
  pages: () => publicGet<CmsPage[]>('/public/pages'),
  announcements: () => publicGet<CmsAnnouncement[]>('/public/announcements'),
}

// Public admission enquiry — tenant resolved from the site's slug (X-Tenant-Slug).
// An enquiry submitted on a school's site is scoped to that tenant only.
export interface EnquiryInput {
  applicant_name: string
  applicant_dob?: string
  parent_name?: string
  parent_phone?: string
  notes?: string
}

export const admissionsPublic = {
  submitEnquiry: (d: EnquiryInput) =>
    publicPost<{ id: string; status: string; message: string }>('/admissions/enquiry', d),
}

// Admin (authenticated)
export const cmsAdmin = {
  listPages: () => request<CmsPage[]>('/cms/pages'),
  createPage: (d: PageCreate) => request<CmsPage>('/cms/pages', { method: 'POST', body: JSON.stringify(d) }),
  updatePage: (id: string, d: Partial<PageCreate>) =>
    request<CmsPage>(`/cms/pages/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
  deletePage: (id: string) => request<void>(`/cms/pages/${id}`, { method: 'DELETE' }),

  listAnnouncements: () => request<CmsAnnouncement[]>('/cms/announcements'),
  createAnnouncement: (d: AnnouncementCreate) =>
    request<CmsAnnouncement>('/cms/announcements', { method: 'POST', body: JSON.stringify(d) }),
  updateAnnouncement: (id: string, d: Partial<AnnouncementCreate>) =>
    request<CmsAnnouncement>(`/cms/announcements/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
  deleteAnnouncement: (id: string) => request<void>(`/cms/announcements/${id}`, { method: 'DELETE' }),
}
