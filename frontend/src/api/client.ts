import type { LoginRequest, TokenResponse } from '../types/auth'

const BASE = '/api/v1'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: 'Request failed' }))
    throw new Error((body as { detail?: string }).detail ?? 'Request failed')
  }
  return res.json() as Promise<T>
}

export function login(req: LoginRequest): Promise<TokenResponse> {
  return request<TokenResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(req),
  })
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
