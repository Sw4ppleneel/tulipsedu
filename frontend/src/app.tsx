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
function StaffPortal({ role, schoolName, firstName, onLogout }: { role: string; schoolName: string; firstName: string; onLogout: () => void }) {
  const [features, setFeatures] = useState<FeatureFlags | null>(null)
  useEffect(() => { featuresApi.get().then(f => { setFeatures(f); setSectionLabel(f.section_label ?? 'Section') }).catch(() => {}) }, [])
  const config = buildPortalConfig({ role, schoolName, firstName, features, onLogout })
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
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  async function handleLogin(e: Event) {
    e.preventDefault()
    setLoading(true); setErr('')
    try { onSuccess(await loginByAdmissionNo(slug, admNo.trim()), slug) }
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
    if (saved) return saved.role === 'parent' ? 'parent-app' : 'staff-app'
    return initialMode()
  })
  const [userRole, setUserRole] = useState(() => restoreAuthState()?.role ?? '')
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
      const role = claims.role as string
      const fn = (claims.first_name as string) || ''
      setAuthState({
        accessToken: tokens.access_token,
        tenantSlug: (claims.tenant_slug as string) || tenantSlug,
        userId: claims.sub as string,
        role,
        firstName: fn,
      })
      setUserRole(role)
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
      role: 'parent',
    })
    setUserRole('parent')
    setMode('parent-app')
  }

  function handleLogout() {
    clearAuthState(); setPassword(''); setUserRole('')
    history.pushState(null, '', '/app'); setMode('login')
  }
  function handleParentLogout() {
    clearAuthState(); setUserRole('')
    history.pushState(null, '', '/'); setMode('public')
  }

  if (mode === 'public') return <PublicSite onStaffLogin={goStaffLogin} onParentLogin={goParentLogin} />
  if (mode === 'staff-app')
    return <StaffPortal role={userRole} schoolName={schoolName} firstName={firstName} onLogout={handleLogout} />

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
