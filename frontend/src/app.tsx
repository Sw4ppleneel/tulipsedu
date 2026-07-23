import { useEffect, useState } from 'preact/hooks'
import { login } from './api/client'
import { clearAuthState, decodeJWT, restoreAuthState, setAuthState, setSectionLabel } from './api/auth_state'
import { loginByAdmissionNo } from './api/parent'
import { ParentPortalView } from './views/ParentPortal'
import { PublicSite } from './views/PublicSite'
import { PortalShell } from './portals/PortalShell'
import { buildPortalConfig } from './portals/configs'
import { featuresApi, type FeatureFlags } from './api/notifications'
import { Brand, PasswordInput } from './ui'
import type { TokenResponse } from './types/auth'

function getSubdomain(): string {
  const parts = window.location.hostname.split('.')
  return parts.length > 2 ? parts[0] : ''
}

// ── Staff portal ──────────────────────────────────────────────────────────────
// Resolves the role to its dedicated portal (section set + big-button home) on
// the shared PortalShell. Module gating (GET /me/features) is applied while
// building the principal config; the backend remains the real authorization gate.
function StaffPortal({ role, allRoles, onSwitchRole, schoolName, firstName, onLogout }: {
  role: string; allRoles: string[]; onSwitchRole: (role: string) => void
  schoolName: string; firstName: string; onLogout: () => void
}) {
  const [features, setFeatures] = useState<FeatureFlags | null>(null)
  useEffect(() => { featuresApi.get().then(f => { setFeatures(f); setSectionLabel(f.section_label ?? 'Section') }).catch(() => {}) }, [])
  const config = buildPortalConfig({ role, allRoles, onSwitchRole, schoolName, firstName, features, onLogout })
  return <PortalShell config={config} />
}

// ── Parent Login (admission number) ──────────────────────────────────────────

function ParentLogin({
  onSuccess, onBack,
}: {
  onSuccess: (tokens: { access_token: string }, slug: string) => void
  onBack: () => void
}) {
  const [slug, setSlug] = useState(getSubdomain)
  const [admNo, setAdmNo] = useState('')
  const [password, setPassword] = useState('')
  // null = flag unknown (school-info not loaded yet) → hide the field until known
  const [needsPassword, setNeedsPassword] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  // The tenant decides whether parent login needs a password
  // (feature_flags.parent_password, surfaced on the public school-info endpoint).
  useEffect(() => {
    const s = slug.trim().toLowerCase()
    if (!s) { setNeedsPassword(null); return }
    let cancelled = false
    fetch(`/api/v1/public/school-info`, { headers: { 'X-Tenant-Slug': s } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled) setNeedsPassword(d ? !!d.parent_password : null) })
      .catch(() => { if (!cancelled) setNeedsPassword(null) })
    return () => { cancelled = true }
  }, [slug])

  async function handleLogin(e: Event) {
    e.preventDefault()
    setLoading(true); setErr('')
    try { onSuccess(await loginByAdmissionNo(slug, admNo.trim(), needsPassword ? password : undefined), slug) }
    catch (ex) { setErr(ex instanceof Error ? ex.message : 'Login failed') }
    finally { setLoading(false) }
  }

  return (
    <div style={LOGIN_PAGE}>
      <div style={LOGIN_CARD}>
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'center' }}><Brand /></div>
          <div style={{ fontWeight: 700, fontSize: '1.25rem', color: 'var(--gray-900)', marginTop: '.75rem', fontFamily: 'var(--font-display)' }}>Parent Login</div>
          <div class="text-muted text-sm" style={{ marginTop: '.25rem' }}>Enter your child's admission number</div>
        </div>

        {err && <div class="err" style={{ marginBottom: '1rem', padding: '.5rem .75rem', background: 'var(--c-danger-lt)', borderRadius: 'var(--r)' }}>{err}</div>}

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '.875rem' }}>
          {!getSubdomain() && (
            <div>
              <label class="lbl">School ID</label>
              <input class="input" value={slug} onInput={e => setSlug((e.target as HTMLInputElement).value)} placeholder="demo" required />
            </div>
          )}
          <div>
            <label class="lbl">Admission number</label>
            <input class="input" value={admNo} onInput={e => setAdmNo((e.target as HTMLInputElement).value)}
              placeholder="e.g. 2024001" required autocomplete="off" />
          </div>
          {needsPassword && (
            <div>
              <label class="lbl">Password</label>
              <PasswordInput value={password} onInput={setPassword} placeholder="Password" required autocomplete="current-password" />
              <p class="text-muted" style={{ fontSize: '.7rem', marginTop: '.3rem', marginBottom: 0 }}>
                First time? Use the last 4 digits of your registered mobile number.
              </p>
            </div>
          )}
          <button class="btn btn-primary btn-lg" type="submit" disabled={loading} style={{ width: '100%', marginTop: '.25rem' }}>
            {loading ? 'Signing in…' : 'View my child'}
          </button>
        </form>
        <p class="text-muted" style={{ fontSize: '.72rem', marginTop: '.75rem', textAlign: 'center' }}>
          The admission number is printed on your child's ID card and fee receipts.
        </p>
        <button onClick={onBack} style={{ width: '100%', marginTop: '.75rem', background: 'none', border: 'none', cursor: 'pointer', fontSize: '.8rem', color: 'var(--gray-500)', fontFamily: 'inherit' }}>
          ← Staff login
        </button>
      </div>
    </div>
  )
}

// ── Login page ────────────────────────────────────────────────────────────────

const LOGIN_PAGE: preact.JSX.CSSProperties = {
  display: 'flex', justifyContent: 'center', alignItems: 'center',
  minHeight: '100vh', fontFamily: 'var(--font)',
  background: 'linear-gradient(160deg, #EDF3EE 0%, #F7F9F5 55%, #FBEFCF 140%)',
}
const LOGIN_CARD: preact.JSX.CSSProperties = {
  width: '100%', maxWidth: 380, background: '#fff', borderRadius: 14,
  padding: '2rem 2rem 1.75rem', boxShadow: '0 18px 50px -18px rgba(13,51,42,.25)',
  border: '1px solid var(--gray-200)',
}

type AppMode = 'public' | 'login' | 'parent-login' | 'staff-app' | 'parent-app'

// Path-based routing: / = public website, /app = staff ERP, /parent = parent portal
function initialMode(): AppMode {
  const path = window.location.pathname
  if (path.startsWith('/app')) return 'login'
  if (path.startsWith('/parent')) return 'parent-login'
  return 'public'
}

export function App() {
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [tenantSlug, setTenantSlug] = useState(getSubdomain)
  const [schoolName, setSchoolName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<AppMode>(() => {
    const saved = restoreAuthState()
    if (saved) return saved.roles.includes('parent') ? 'parent-app' : 'staff-app'
    return initialMode()
  })
  const [activeRole, setActiveRole] = useState(() => restoreAuthState()?.activeRole ?? '')
  const [allRoles, setAllRoles] = useState<string[]>(() => restoreAuthState()?.roles ?? [])
  const [firstName, setFirstName] = useState(() => restoreAuthState()?.firstName ?? '')

  function goStaffLogin() {
    history.pushState(null, '', '/app')
    setError(''); setMode('login')
  }
  function goParentLogin() {
    history.pushState(null, '', '/parent')
    setError(''); setMode('parent-login')
  }
  function goPublic() {
    history.pushState(null, '', '/')
    setMode('public')
  }

  // Silently re-validate roles against the server on every load of a
  // restored staff session, instead of trusting the cached access token
  // blindly for its full lifetime. Closes the staleness window from "up to
  // an hour, until the token expires and forces a fresh login" down to
  // "next page load" — e.g. a principal correcting someone's role takes
  // effect the moment that person's browser is reloaded, not up to an hour
  // later. Parent sessions have no refresh token and are skipped.
  useEffect(() => {
    const saved = restoreAuthState()
    if (!saved?.refreshToken || saved.roles.includes('parent')) return
    import('./api/client').then(m => m.refresh(saved.refreshToken!)).then(tokens => {
      const claims = decodeJWT(tokens.access_token)
      const roles = (claims.roles as string[]) || []
      if (roles.length === 0) return
      const activeRole = roles.includes(saved.activeRole) ? saved.activeRole : roles[0]
      setAuthState({
        ...saved,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        roles,
        activeRole,
      })
      setAllRoles(roles)
      setActiveRole(activeRole)
    }).catch(() => {
      // Refresh token itself invalid/expired — fall back to the cached
      // state as-is (still usable until its own access token expires);
      // don't force a disruptive logout over a transient network error.
    })
  }, [])

  // Browser back/forward → re-derive route, but don't disrupt an active session
  useEffect(() => {
    const onPop = () => {
      setMode(prev => (prev === 'staff-app' || prev === 'parent-app') ? prev : initialMode())
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Fetch school name from public API once slug is known
  useEffect(() => {
    if (!tenantSlug) return
    fetch(`/api/v1/public/school-info`, {
      headers: { 'X-Tenant-Slug': tenantSlug },
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.name) setSchoolName(d.name) })
      .catch(() => {})
  }, [tenantSlug])

  async function handleStaffLogin(e: Event) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const tokens: TokenResponse = await import('./api/client').then(m =>
        m.login({ phone_number: phone, password }, tenantSlug)
      )
      const claims = decodeJWT(tokens.access_token)
      const roles = claims.roles as string[]
      const fn = (claims.first_name as string) || ''
      setAuthState({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tenantSlug: (claims.tenant_slug as string) || tenantSlug,
        userId: claims.sub as string,
        roles,
        activeRole: roles[0],
        firstName: fn,
      })
      setAllRoles(roles)
      setActiveRole(roles[0])
      setFirstName(fn)
      setMode('staff-app')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally { setLoading(false) }
  }

  function handleParentSuccess(tokens: { access_token: string }, slug: string) {
    const claims = decodeJWT(tokens.access_token)
    setAuthState({
      accessToken: tokens.access_token,
      tenantSlug: (claims.tenant_slug as string) || slug,
      userId: claims.sub as string,
      roles: ['parent'],
      activeRole: 'parent',
    })
    setActiveRole('parent')
    setAllRoles(['parent'])
    setMode('parent-app')
  }

  function handleLogout() {
    clearAuthState(); setPassword(''); setActiveRole(''); setAllRoles([])
    history.pushState(null, '', '/app'); setMode('login')
  }
  function handleParentLogout() {
    clearAuthState(); setActiveRole(''); setAllRoles([])
    history.pushState(null, '', '/'); setMode('public')
  }

  function handleSwitchRole(role: string) {
    setActiveRole(role)
    const saved = restoreAuthState()
    if (saved) setAuthState({ ...saved, activeRole: role })
  }

  if (mode === 'public') return <PublicSite onStaffLogin={goStaffLogin} onParentLogin={goParentLogin} />
  if (mode === 'staff-app')
    return <StaffPortal role={activeRole} allRoles={allRoles} onSwitchRole={handleSwitchRole} schoolName={schoolName} firstName={firstName} onLogout={handleLogout} />

  if (mode === 'parent-app') return <ParentPortalView onLogout={handleParentLogout} />
  if (mode === 'parent-login') return <ParentLogin onSuccess={handleParentSuccess} onBack={goPublic} />

  // Staff login page
  return (
    <div style={LOGIN_PAGE}>
      <div style={LOGIN_CARD}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'center' }}><Brand /></div>
          <div style={{ fontWeight: 700, fontSize: '1.35rem', color: 'var(--gray-900)', marginTop: '.875rem', lineHeight: 1.2, fontFamily: 'var(--font-display)' }}>
            {schoolName || 'Tulips.edu'}
          </div>
          {schoolName && (
            <div class="text-muted text-xs" style={{ marginTop: '.2rem' }}>School Management Portal</div>
          )}
          {!schoolName && (
            <div class="text-muted text-sm" style={{ marginTop: '.2rem' }}>School Management Platform</div>
          )}
        </div>

        {error && (
          <div class="err" style={{ marginBottom: '1rem', padding: '.5rem .75rem', background: 'var(--c-danger-lt)', borderRadius: 'var(--r)' }}>{error}</div>
        )}

        <form onSubmit={handleStaffLogin} style={{ display: 'flex', flexDirection: 'column', gap: '.875rem' }}>
          {!getSubdomain() && (
            <div>
              <label class="lbl">School ID</label>
              <input
                class="input"
                value={tenantSlug}
                onInput={e => setTenantSlug((e.target as HTMLInputElement).value)}
                placeholder="demo"
                required
              />
            </div>
          )}
          <div>
            <label class="lbl">Phone number</label>
            <input class="input" type="tel" value={phone}
              onInput={e => setPhone((e.target as HTMLInputElement).value)}
              placeholder="9999999999" required />
          </div>
          <div>
            <label class="lbl">Password</label>
            <PasswordInput value={password} onInput={setPassword} required />
          </div>
          <button class="btn btn-primary btn-lg" type="submit" disabled={loading} style={{ width: '100%', marginTop: '.375rem' }}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div style={{ marginTop: '.875rem' }}>
          <button
            class="btn btn-ghost"
            style={{ width: '100%' }}
            onClick={goParentLogin}
          >
            Parent Login
          </button>
        </div>

        <button onClick={goPublic} style={{ width: '100%', marginTop: '.75rem', background: 'none', border: 'none', cursor: 'pointer', fontSize: '.78rem', color: 'var(--gray-500)', fontFamily: 'inherit' }}>
          ← School website
        </button>

        <p class="text-muted text-xs" style={{ textAlign: 'center', marginTop: '1rem' }}>
          Powered by Tulips.edu · School ERP
        </p>
      </div>
    </div>
  )
}
