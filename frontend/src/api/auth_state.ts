export interface AuthState {
  accessToken: string
  tenantSlug: string
  userId: string
  role: string
  firstName?: string
}

const STORAGE_KEY = 'tulips_auth'

let _state: AuthState | null = null

export function decodeJWT(token: string): Record<string, unknown> {
  try {
    const base64 = token.split('.')[1]
    return JSON.parse(atob(base64.replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return {}
  }
}

function isTokenExpired(token: string): boolean {
  const claims = decodeJWT(token)
  const exp = claims.exp as number | undefined
  return exp ? Date.now() / 1000 > exp : false
}

export function setAuthState(s: AuthState) {
  _state = s
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) } catch {}
}

export function getAuthState(): AuthState | null { return _state }

export function restoreAuthState(): AuthState | null {
  if (_state) return _state
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as AuthState
    if (isTokenExpired(s.accessToken)) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    _state = s
    return s
  } catch {
    return null
  }
}

export function clearAuthState() {
  _state = null
  try { localStorage.removeItem(STORAGE_KEY) } catch {}
}

let _sectionLabel = 'Section'
export function getSectionLabel(): string { return _sectionLabel }
export function setSectionLabel(label: string) { _sectionLabel = label }
