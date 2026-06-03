import { useState } from 'preact/hooks'
import { login } from './api/client'
import { clearAuthState, decodeJWT, setAuthState } from './api/auth_state'
import { requestOtp, verifyOtp } from './api/parent'
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
import type { TokenResponse } from './types/auth'

function getSubdomain(): string {
  const parts = window.location.hostname.split('.')
  return parts.length > 2 ? parts[0] : ''
}

type View = 'students' | 'staff' | 'attendance' | 'fees' | 'homework' | 'timetable' | 'exams' | 'cms' | 'superadmin'

// ── Staff App Shell ──────────────────────────────────────────────────────────

function AppShell({ onLogout, role }: { onLogout: () => void; role: string }) {
  const [view, setView] = useState<View>(role === 'superadmin' ? 'superadmin' : 'students')

  const NAV = (active: boolean, accent?: string): preact.JSX.CSSProperties => ({
    padding: '0.375rem 0.875rem',
    background: active ? (accent ?? '#1e40af') : 'transparent',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: active ? 600 : 400,
  })

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb', fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ background: '#1a56db', color: '#fff', padding: '0 1.5rem', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <span style={{ fontWeight: 700, fontSize: '1rem', letterSpacing: '-0.02em' }}>Tulips.edu</span>
          <nav style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
            <button onClick={() => setView('students')}   style={NAV(view === 'students')}>Students</button>
            <button onClick={() => setView('staff')}      style={NAV(view === 'staff')}>Staff</button>
            <button onClick={() => setView('attendance')} style={NAV(view === 'attendance')}>Attendance</button>
            <button onClick={() => setView('fees')}       style={NAV(view === 'fees')}>Fees</button>
            <button onClick={() => setView('homework')}   style={NAV(view === 'homework')}>Homework</button>
            <button onClick={() => setView('timetable')}  style={NAV(view === 'timetable')}>Timetable</button>
            <button onClick={() => setView('exams')}      style={NAV(view === 'exams')}>Exams</button>
            <button onClick={() => setView('cms')}        style={NAV(view === 'cms')}>CMS</button>
            {role === 'superadmin' && (
              <button onClick={() => setView('superadmin')} style={NAV(view === 'superadmin', '#7c3aed')}>
                Superadmin
              </button>
            )}
          </nav>
        </div>
        <button
          onClick={onLogout}
          style={{ background: 'transparent', color: 'rgba(255,255,255,0.8)', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 4, padding: '0.25rem 0.75rem', cursor: 'pointer', fontSize: '0.8rem' }}
        >
          Sign out
        </button>
      </header>
      <main>
        {view === 'students'   && <StudentsView />}
        {view === 'staff'      && <StaffView />}
        {view === 'attendance' && <AttendanceView />}
        {view === 'fees'       && <FeesAdminView />}
        {view === 'homework'   && <HomeworkView />}
        {view === 'timetable'  && <TimetableView />}
        {view === 'exams'      && <ExamView />}
        {view === 'cms'        && <CmsAdminView />}
        {view === 'superadmin' && <SuperadminView />}
      </main>
    </div>
  )
}

// ── OTP Login (Parent) ───────────────────────────────────────────────────────

function ParentLogin({
  onSuccess, onBack,
}: {
  onSuccess: (tokens: { access_token: string; refresh_token: string }, slug: string) => void
  onBack: () => void
}) {
  const [slug, setSlug] = useState(getSubdomain)
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [devOtp, setDevOtp] = useState('')
  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  async function handleRequestOtp(e: Event) {
    e.preventDefault()
    if (!slug || !phone) { setErr('School ID and phone are required'); return }
    setLoading(true); setErr('')
    try {
      const res = await requestOtp(slug, phone)
      if (res.dev_otp) setDevOtp(res.dev_otp)
      setStep('otp')
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Error')
    } finally { setLoading(false) }
  }

  async function handleVerifyOtp(e: Event) {
    e.preventDefault()
    if (!otp) { setErr('Enter the OTP'); return }
    setLoading(true); setErr('')
    try {
      const tokens = await verifyOtp(slug, phone, otp)
      onSuccess(tokens, slug)
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Verification failed')
    } finally { setLoading(false) }
  }

  return (
    <div style={S.page}>
      <div style={S.card}>
        <h1 style={{ margin: '0 0 0.25rem', fontSize: '1.5rem', fontWeight: 700, color: '#1a56db' }}>Tulips.edu</h1>
        <p style={{ margin: '0 0 1.5rem', fontSize: '0.8rem', color: '#6b7280' }}>Parent Portal</p>
        {err && <p style={{ color: 'red', marginBottom: '1rem', fontSize: '0.875rem' }}>{err}</p>}

        {step === 'phone' ? (
          <form onSubmit={handleRequestOtp}>
            {!getSubdomain() && (
              <div style={S.field}>
                <label style={S.label}>School ID</label>
                <input value={slug} onInput={e => setSlug((e.target as HTMLInputElement).value)} style={S.input} placeholder="demo" required />
              </div>
            )}
            <div style={S.field}>
              <label style={S.label}>Phone number (registered with school)</label>
              <input type="tel" value={phone} onInput={e => setPhone((e.target as HTMLInputElement).value)} style={S.input} placeholder="9876543210" required />
            </div>
            <button type="submit" disabled={loading} style={S.btn}>{loading ? 'Sending OTP…' : 'Send OTP'}</button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp}>
            <p style={{ fontSize: '0.875rem', color: '#374151', marginBottom: '1rem' }}>
              OTP sent to <strong>{phone}</strong>
            </p>
            {devOtp && (
              <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 4, padding: '0.5rem 0.75rem', marginBottom: '1rem', fontSize: '0.8rem', color: '#92400e' }}>
                Dev mode — OTP: <strong style={{ fontSize: '1rem', letterSpacing: '0.1em' }}>{devOtp}</strong>
              </div>
            )}
            <div style={S.field}>
              <label style={S.label}>Enter OTP</label>
              <input
                value={otp}
                onInput={e => setOtp((e.target as HTMLInputElement).value)}
                style={{ ...S.input, letterSpacing: '0.2em', fontSize: '1.25rem', textAlign: 'center' }}
                placeholder="000000"
                maxLength={6}
                inputMode="numeric"
                required
              />
            </div>
            <button type="submit" disabled={loading} style={S.btn}>{loading ? 'Verifying…' : 'Verify OTP'}</button>
            <button
              type="button"
              onClick={() => { setStep('phone'); setOtp(''); setDevOtp(''); setErr('') }}
              style={{ width: '100%', marginTop: '0.5rem', padding: '0.5rem', background: 'none', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem', color: '#374151' }}
            >
              Change phone number
            </button>
          </form>
        )}

        <button onClick={onBack} style={{ width: '100%', marginTop: '1rem', padding: '0.5rem', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8rem', color: '#6b7280' }}>
          ← Staff login
        </button>
      </div>
    </div>
  )
}

// ── Login form ───────────────────────────────────────────────────────────────

const S = {
  page: { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', fontFamily: 'system-ui, sans-serif', background: '#f5f5f5' } as const,
  card: { width: '100%', maxWidth: '360px', background: '#fff', borderRadius: 8, padding: '2rem', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' } as const,
  field: { marginBottom: '1rem' } as const,
  label: { display: 'block', marginBottom: '0.25rem', fontSize: '0.875rem', color: '#444' } as const,
  input: { width: '100%', padding: '0.625rem', border: '1px solid #ccc', borderRadius: 4, fontSize: '1rem', boxSizing: 'border-box' } as const,
  btn: { width: '100%', padding: '0.75rem', background: '#1a56db', color: '#fff', border: 'none', borderRadius: 4, fontSize: '1rem', cursor: 'pointer' } as const,
}

type AppMode = 'login' | 'parent-login' | 'staff-app' | 'parent-app'

export function App() {
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [tenantSlug, setTenantSlug] = useState(getSubdomain)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<AppMode>('login')
  const [userRole, setUserRole] = useState('')

  async function handleStaffLogin(e: Event) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const tokens: TokenResponse = await login({ phone_number: phone, password }, tenantSlug)
      const claims = decodeJWT(tokens.access_token)
      const role = claims.role as string
      setAuthState({
        accessToken: tokens.access_token,
        tenantSlug: (claims.tenant_slug as string) || tenantSlug,
        userId: claims.sub as string,
        role,
      })
      setUserRole(role)
      setMode(role === 'parent' ? 'parent-app' : 'staff-app')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  function handleParentSuccess(tokens: { access_token: string; refresh_token: string }, slug: string) {
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
    clearAuthState()
    setMode('login')
    setPassword('')
    setUserRole('')
  }

  if (mode === 'staff-app') {
    return <AppShell onLogout={handleLogout} role={userRole} />
  }

  if (mode === 'parent-app') {
    return <ParentPortalView onLogout={handleLogout} />
  }

  if (mode === 'parent-login') {
    return <ParentLogin onSuccess={handleParentSuccess} onBack={() => setMode('login')} />
  }

  return (
    <div style={S.page}>
      <form onSubmit={handleStaffLogin} style={S.card}>
        <h1 style={{ margin: '0 0 0.25rem', fontSize: '1.5rem', fontWeight: 700, color: '#1a56db' }}>Tulips.edu</h1>
        <p style={{ margin: '0 0 1.5rem', fontSize: '0.8rem', color: '#6b7280' }}>Staff Portal</p>
        {error && <p style={{ color: 'red', marginBottom: '1rem', fontSize: '0.875rem' }}>{error}</p>}

        {!getSubdomain() && (
          <div style={S.field}>
            <label style={S.label}>School ID</label>
            <input
              value={tenantSlug}
              onInput={(e) => setTenantSlug((e.target as HTMLInputElement).value)}
              style={S.input}
              placeholder="demo"
              required
            />
          </div>
        )}

        <div style={S.field}>
          <label style={S.label}>Phone number</label>
          <input
            type="tel"
            value={phone}
            onInput={(e) => setPhone((e.target as HTMLInputElement).value)}
            style={S.input}
            placeholder="9999999999"
            required
          />
        </div>
        <div style={{ ...S.field, marginBottom: '1.5rem' }}>
          <label style={S.label}>Password</label>
          <input
            type="password"
            value={password}
            onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
            style={S.input}
            required
          />
        </div>
        <button type="submit" disabled={loading} style={S.btn}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
        <button
          type="button"
          onClick={() => setMode('parent-login')}
          style={{ width: '100%', marginTop: '0.75rem', padding: '0.625rem', background: 'none', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.875rem', cursor: 'pointer', color: '#374151' }}
        >
          Parent Login (OTP)
        </button>
      </form>
    </div>
  )
}
