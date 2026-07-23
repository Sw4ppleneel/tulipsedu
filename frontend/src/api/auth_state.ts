export interface AuthState {
  accessToken: string
  // Staff sessions only (parents don't get a refresh token) — lets the app
  // silently re-validate roles on load instead of trusting a cached access
  // token blindly for its full lifetime. Without this, a role correction
  // made server-side wouldn't reach an already-open tab until its access
  // token happened to expire and force a fresh login.
  refreshToken?: string
  tenantSlug: string
  userId: string
  // All roles this login holds (usually one; can be more, e.g. accountant +
  // teacher). activeRole is which one's portal is currently displayed — a
  // pure UI concern, never sent to the backend as a scoping parameter.
  roles: string[]
  activeRole: string
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
  // activeRole must always be a held role; fall back to the first if the
  // caller didn't pick one (e.g. first login) or picked one no longer held.
  const activeRole = s.roles.includes(s.activeRole) ? s.activeRole : s.roles[0]
  _state = { ...s, activeRole }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_state)) } catch {}
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
