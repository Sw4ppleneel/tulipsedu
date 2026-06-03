export interface AuthState {
  accessToken: string
  tenantSlug: string
  userId: string
  role: string
}

let _state: AuthState | null = null

export function setAuthState(s: AuthState) { _state = s }
export function getAuthState(): AuthState | null { return _state }
export function clearAuthState() { _state = null }

export function decodeJWT(token: string): Record<string, unknown> {
  try {
    const base64 = token.split('.')[1]
    return JSON.parse(atob(base64.replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return {}
  }
}
