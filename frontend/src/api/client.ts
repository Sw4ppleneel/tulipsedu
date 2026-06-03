import { getAuthState } from './auth_state'
import type { LoginRequest, TokenResponse } from '../types/auth'

const BASE = '/api/v1'

async function request<T>(
  path: string,
  options?: RequestInit,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const auth = getAuthState()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(auth
      ? { Authorization: `Bearer ${auth.accessToken}`, 'X-Tenant-Slug': auth.tenantSlug }
      : {}),
    ...extraHeaders,
  }
  const res = await fetch(`${BASE}${path}`, { ...options, headers })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: 'Request failed' }))
    throw new Error((body as { detail?: string }).detail ?? 'Request failed')
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export function login(req: LoginRequest, tenantSlug: string): Promise<TokenResponse> {
  return request<TokenResponse>(
    '/auth/login',
    { method: 'POST', body: JSON.stringify(req) },
    { 'X-Tenant-Slug': tenantSlug },
  )
}

export function refresh(refreshToken: string): Promise<TokenResponse> {
  return request<TokenResponse>('/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: refreshToken }),
  })
}

export function logout(): Promise<{ detail: string }> {
  return request<{ detail: string }>('/auth/logout', { method: 'POST' })
}

export { request }
