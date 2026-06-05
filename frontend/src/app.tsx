import { useEffect, useState } from 'preact/hooks'
import { login } from './api/client'
import { clearAuthState, decodeJWT, setAuthState } from './api/auth_state'
import { requestOtp, verifyOtp } from './api/parent'
import { DashboardView } from './views/Dashboard'
import { StudentsView } from './views/Students'
import { StaffView } from './views/Staff'
import { AttendanceView } from './views/Attendance'
import { FeesAdminView } from './views/FeesAdmin'
import { SuperadminView } from './views/Superadmin'
import { HomeworkView } from './views/Homework'
import { TimetableView } from './views/Timetable'
import { ExamView } from './views/Exam'
import { ParentPortalView } from './views/ParentPortal'
import { CmsAdminView } from './views/CmsAdmin'
import { SettingsView } from './views/Settings'
import type { TokenResponse } from './types/auth'

function getSubdomain(): string {
  const parts = window.location.hostname.split('.')
  return parts.length > 2 ? parts[0] : ''
}

type View = 'dashboard' | 'students' | 'staff' | 'attendance' | 'fees' | 'homework' | 'timetable' | 'exams' | 'cms' | 'settings' | 'superadmin'

// Display order of nav tabs.
const ALL_VIEWS: { key: View; label: string }[] = [
  { key: 'dashboard',  label: 'Home' },
  { key: 'students',   label: 'Students' },
  { key: 'staff',      label: 'Staff' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'fees',       label: 'Fees' },
  { key: 'homework',   label: 'Homework' },
  { key: 'timetable',  label: 'Timetable' },
  { key: 'exams',      label: 'Exams' },
  { key: 'cms',        label: 'CMS' },
  { key: 'settings',   label: 'Settings' },
  { key: 'superadmin', label: 'Superadmin' },
]

// Which roles may see each view. Mirrors the backend route guards in
// backend/core/rbac.py — the backend is the real boundary; this only
// controls what the staff app renders. superadmin is handled separately.
const VIEW_ACCESS: Record<View, string[]> = {
  dashboard:  ['principal', 'vice_principal'],
  students:   ['principal', 'vice_principal'],
  staff:      ['principal', 'vice_principal'],
  attendance: ['principal', 'vice_principal', 'class_teacher', 'teacher'],
  fees:       ['principal', 'vice_principal', 'accountant'],
  homework:   ['principal', 'vice_principal', 'class_teacher', 'teacher'],
  timetable:  ['principal', 'vice_principal', 'class_teacher', 'teacher'],
  exams:      ['principal', 'vice_principal', 'class_teacher', 'teacher'],
  cms:        ['principal'],
  settings:   ['principal'],
  superadmin: ['superadmin'],
}

function canSee(role: string, v: View): boolean {
  if (role === 'superadmin') return v === 'superadmin'
  return VIEW_ACCESS[v].includes(role)
}

// ── Nav icon helper (small SVG) ───────────────────────────────────────────────
const ICONS: Record<string, string> = {
  dashboard:  '⊞',
  students:   '🎓',
  staff:      '👥',
  attendance: '✓',
  fees:       '₹',
  homework:   '📚',
  timetable:  '🗓',
  exams:      '📝',
  cms:        '🌐',
  settings:   '⚙',
  superadmin: '🛡',
}

// ── Staff App Shell ───────────────────────────────────────────────────────────

function AppShell({ onLogout, role, schoolName }: { onLogout: () => void; role: string; schoolName: string }) {
  const NAV_ITEMS = ALL_VIEWS.filter((item) => canSee(role, item.key))
  const landing: View = NAV_ITEMS[0]?.key ?? 'dashboard'
  const [view, setView] = useState<View>(landing)
  const [menuOpen, setMenuOpen] = useState(false)

  function navBtn(item: { key: View; label: string }) {
    const active = view === item.key
    return (
      <button
        key={item.key}
        onClick={() => { setView(item.key); setMenuOpen(false) }}
        style={{
          display: 'flex', alignItems: 'center', gap: '.375rem',
          padding: '.35rem .7rem',
          background: active ? 'rgba(255,255,255,.18)' : 'transparent',
          color: active ? '#fff' : 'rgba(255,255,255,.75)',
          border: active ? '1px solid rgba(255,255,255,.25)' : '1px solid transparent',
          borderRadius: 5,
          cursor: 'pointer',
          fontSize: '.8125rem',
          fontWeight: active ? 600 : 400,
          fontFamily: 'inherit',
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ fontSize: '.875rem', lineHeight: 1 }}>{ICONS[item.key]}</span>
        {item.label}
      </button>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--gray-50)', fontFamily: 'var(--font)' }}>
      <header style={{
        background: 'linear-gradient(135deg, #1a56db 0%, #1e40af 100%)',
        color: '#fff',
        padding: '0 1.25rem',
        height: 54,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        boxShadow: '0 2px 8px rgba(26,86,219,.3)',
        position: 'sticky', top: 0, zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', minWidth: 0 }}>
          {/* Logo mark */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexShrink: 0 }}>
            <div style={{ width: 30, height: 30, background: 'rgba(255,255,255,.2)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: '1rem' }}>T</div>
            <div style={{ lineHeight: 1.15 }}>
              <div style={{ fontWeight: 800, fontSize: '.9rem', letterSpacing: '-.01em' }}>Tulips.edu</div>
              {schoolName && <div style={{ fontSize: '.65rem', opacity: .75, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{schoolName}</div>}
            </div>
          </div>
          {/* Nav */}
          <nav style={{ display: 'flex', gap: '.2rem', flexWrap: 'nowrap', overflow: 'hidden' }}>
            {NAV_ITEMS.map(navBtn)}
          </nav>
        </div>
        <button
          onClick={onLogout}
          style={{ background: 'rgba(255,255,255,.12)', color: 'rgba(255,255,255,.9)', border: '1px solid rgba(255,255,255,.2)', borderRadius: 5, padding: '.3rem .75rem', cursor: 'pointer', fontSize: '.75rem', fontFamily: 'inherit', flexShrink: 0 }}
        >
          Sign out
        </button>
      </header>

      <main>
        {view === 'dashboard'  && canSee(role, 'dashboard')  && <DashboardView schoolName={schoolName} />}
        {view === 'students'   && canSee(role, 'students')   && <StudentsView />}
        {view === 'staff'      && canSee(role, 'staff')      && <StaffView />}
        {view === 'attendance' && canSee(role, 'attendance') && <AttendanceView />}
        {view === 'fees'       && canSee(role, 'fees')       && <FeesAdminView />}
        {view === 'homework'   && canSee(role, 'homework')   && <HomeworkView />}
        {view === 'timetable'  && canSee(role, 'timetable')  && <TimetableView />}
        {view === 'exams'      && canSee(role, 'exams')      && <ExamView />}
        {view === 'cms'        && canSee(role, 'cms')        && <CmsAdminView />}
        {view === 'settings'   && canSee(role, 'settings')   && <SettingsView />}
        {view === 'superadmin' && canSee(role, 'superadmin') && <SuperadminView />}
      </main>
    </div>
  )
}

// ── OTP Login (Parent) ────────────────────────────────────────────────────────

function ParentLogin({
  onSuccess, onBack,
}: {
  onSuccess: (tokens: { access_token: string }, slug: string) => void
  onBack: () => void
}) {
  const [slug, setSlug] = useState(getSubdomain)
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [devOtp, setDevOtp] = useState('')
  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  async function handleRequest(e: Event) {
    e.preventDefault()
    setLoading(true); setErr('')
    try {
      const res = await requestOtp(slug, phone)
      if (res.dev_otp) setDevOtp(res.dev_otp)
      setStep('otp')
    } catch (ex) { setErr(ex instanceof Error ? ex.message : 'Error') }
    finally { setLoading(false) }
  }

  async function handleVerify(e: Event) {
    e.preventDefault()
    setLoading(true); setErr('')
    try { onSuccess(await verifyOtp(slug, phone, otp), slug) }
    catch (ex) { setErr(ex instanceof Error ? ex.message : 'Verification failed') }
    finally { setLoading(false) }
  }

  return (
    <div style={LOGIN_PAGE}>
      <div style={LOGIN_CARD}>
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <div style={LOGO_MARK}>T</div>
          <div style={{ fontWeight: 800, fontSize: '1.25rem', color: 'var(--gray-900)', marginTop: '.75rem' }}>Parent Login</div>
          <div class="text-muted text-sm" style={{ marginTop: '.25rem' }}>Enter your registered phone number</div>
        </div>

        {err && <div class="err" style={{ marginBottom: '1rem', padding: '.5rem .75rem', background: 'var(--c-danger-lt)', borderRadius: 'var(--r)' }}>{err}</div>}

        {step === 'phone' ? (
          <form onSubmit={handleRequest} style={{ display: 'flex', flexDirection: 'column', gap: '.875rem' }}>
            {!getSubdomain() && (
              <div>
                <label class="lbl">School ID</label>
                <input class="input" value={slug} onInput={e => setSlug((e.target as HTMLInputElement).value)} placeholder="demo" required />
              </div>
            )}
            <div>
              <label class="lbl">Phone number</label>
              <input class="input" type="tel" value={phone} onInput={e => setPhone((e.target as HTMLInputElement).value)} placeholder="9876543210" required />
            </div>
            <button class="btn btn-primary btn-lg" type="submit" disabled={loading} style={{ width: '100%', marginTop: '.25rem' }}>
              {loading ? 'Sending…' : 'Send OTP'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerify} style={{ display: 'flex', flexDirection: 'column', gap: '.875rem' }}>
            <p class="text-sm" style={{ color: 'var(--gray-700)', marginBottom: '.25rem' }}>OTP sent to <strong>{phone}</strong></p>
            {devOtp && (
              <div style={{ background: 'var(--c-warn-lt)', border: '1px solid #fcd34d', borderRadius: 'var(--r)', padding: '.5rem .75rem', fontSize: '.8rem', color: '#92400e' }}>
                Dev mode · OTP: <strong style={{ fontSize: '1.1rem', letterSpacing: '.15em' }}>{devOtp}</strong>
              </div>
            )}
            <div>
              <label class="lbl">Enter OTP</label>
              <input class="input" value={otp} onInput={e => setOtp((e.target as HTMLInputElement).value)}
                style={{ letterSpacing: '.2em', fontSize: '1.25rem', textAlign: 'center' }}
                placeholder="000000" maxLength={6} inputMode="numeric" required />
            </div>
            <button class="btn btn-primary btn-lg" type="submit" disabled={loading} style={{ width: '100%' }}>
              {loading ? 'Verifying…' : 'Verify OTP'}
            </button>
            <button type="button" class="btn btn-ghost" style={{ width: '100%' }}
              onClick={() => { setStep('phone'); setOtp(''); setDevOtp(''); setErr('') }}>
              ← Change number
            </button>
          </form>
        )}
        <button onClick={onBack} style={{ width: '100%', marginTop: '1rem', background: 'none', border: 'none', cursor: 'pointer', fontSize: '.8rem', color: 'var(--gray-500)', fontFamily: 'inherit' }}>
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
  background: 'linear-gradient(145deg, #eff6ff 0%, #f0fdf4 50%, #fafafa 100%)',
}
const LOGIN_CARD: preact.JSX.CSSProperties = {
  width: '100%', maxWidth: 380, background: '#fff', borderRadius: 14,
  padding: '2rem 2rem 1.75rem', boxShadow: '0 8px 32px rgba(26,86,219,.1), 0 2px 8px rgba(0,0,0,.06)',
  border: '1px solid rgba(26,86,219,.08)',
}
const LOGO_MARK: preact.JSX.CSSProperties = {
  width: 52, height: 52, background: 'linear-gradient(135deg,#1a56db,#1e40af)',
  borderRadius: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  color: '#fff', fontWeight: 900, fontSize: '1.4rem', boxShadow: '0 4px 12px rgba(26,86,219,.3)',
}

type AppMode = 'login' | 'parent-login' | 'staff-app' | 'parent-app'

export function App() {
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [tenantSlug, setTenantSlug] = useState(getSubdomain)
  const [schoolName, setSchoolName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<AppMode>('login')
  const [userRole, setUserRole] = useState('')

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
      setAuthState({
        accessToken: tokens.access_token,
        tenantSlug: (claims.tenant_slug as string) || tenantSlug,
        userId: claims.sub as string,
        role,
      })
      setUserRole(role)
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
    clearAuthState(); setMode('login'); setPassword(''); setUserRole('')
  }

  if (mode === 'staff-app') return <AppShell onLogout={handleLogout} role={userRole} schoolName={schoolName} />
  if (mode === 'parent-app') return <ParentPortalView onLogout={handleLogout} />
  if (mode === 'parent-login') return <ParentLogin onSuccess={handleParentSuccess} onBack={() => setMode('login')} />

  // Staff login page
  return (
    <div style={LOGIN_PAGE}>
      <div style={LOGIN_CARD}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <div style={LOGO_MARK}>T</div>
          <div style={{ fontWeight: 800, fontSize: '1.35rem', color: 'var(--gray-900)', marginTop: '.875rem', lineHeight: 1.2 }}>
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
            <input class="input" type="password" value={password}
              onInput={e => setPassword((e.target as HTMLInputElement).value)}
              required />
          </div>
          <button class="btn btn-primary btn-lg" type="submit" disabled={loading} style={{ width: '100%', marginTop: '.375rem' }}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div style={{ marginTop: '.875rem' }}>
          <button
            class="btn btn-ghost"
            style={{ width: '100%' }}
            onClick={() => setMode('parent-login')}
          >
            Parent Login (OTP)
          </button>
        </div>

        <p class="text-muted text-xs" style={{ textAlign: 'center', marginTop: '1.25rem' }}>
          Powered by Tulips.edu · School ERP
        </p>
      </div>
    </div>
  )
}
