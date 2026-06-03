import { useState } from 'preact/hooks'
import { login } from './api/client'
import { clearAuthState, decodeJWT, setAuthState } from './api/auth_state'
import { StudentsView } from './views/Students'
import { StaffView } from './views/Staff'
import { AttendanceView } from './views/Attendance'
import { FeesAdminView } from './views/FeesAdmin'
import { SuperadminView } from './views/Superadmin'
import { HomeworkView } from './views/Homework'
import { TimetableView } from './views/Timetable'
import { ExamView } from './views/Exam'
import type { TokenResponse } from './types/auth'

// Auto-detect tenant from subdomain; returns empty string on localhost
function getSubdomain(): string {
  const parts = window.location.hostname.split('.')
  return parts.length > 2 ? parts[0] : ''
}

type View = 'students' | 'staff' | 'attendance' | 'fees' | 'homework' | 'timetable' | 'exams' | 'superadmin'

// ── App Shell (authenticated) ────────────────────────────────────────────────

function AppShell({ onLogout, role }: { onLogout: () => void; role: string }) {
  const [view, setView] = useState<View>(role === 'superadmin' ? 'superadmin' : 'students')

  const NAV_BTN = (active: boolean): preact.JSX.CSSProperties => ({
    padding: '0.375rem 0.875rem',
    background: active ? '#1e40af' : 'transparent',
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
          <nav style={{ display: 'flex', gap: '0.25rem' }}>
            <button onClick={() => setView('students')}   style={NAV_BTN(view === 'students')}>Students</button>
            <button onClick={() => setView('staff')}      style={NAV_BTN(view === 'staff')}>Staff</button>
            <button onClick={() => setView('attendance')} style={NAV_BTN(view === 'attendance')}>Attendance</button>
            <button onClick={() => setView('fees')}       style={NAV_BTN(view === 'fees')}>Fees</button>
            <button onClick={() => setView('homework')}   style={NAV_BTN(view === 'homework')}>Homework</button>
            <button onClick={() => setView('timetable')}  style={NAV_BTN(view === 'timetable')}>Timetable</button>
            <button onClick={() => setView('exams')}      style={NAV_BTN(view === 'exams')}>Exams</button>
            {role === 'superadmin' && (
              <button onClick={() => setView('superadmin')} style={{ ...NAV_BTN(view === 'superadmin'), background: view === 'superadmin' ? '#7c3aed' : 'transparent' }}>
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
        {view === 'superadmin' && <SuperadminView />}
      </main>
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

export function App() {
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [tenantSlug, setTenantSlug] = useState(getSubdomain)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [authed, setAuthed] = useState(false)
  const [userRole, setUserRole] = useState('')

  async function handleSubmit(e: Event) {
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
      setAuthed(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  function handleLogout() {
    clearAuthState()
    setAuthed(false)
    setPassword('')
  }

  if (authed) {
    return <AppShell onLogout={handleLogout} role={userRole} />
  }

  return (
    <div style={S.page}>
      <form onSubmit={handleSubmit} style={S.card}>
        <h1 style={{ margin: '0 0 1.5rem', fontSize: '1.5rem', fontWeight: 700, color: '#1a56db' }}>Tulips.edu</h1>
        {error && <p style={{ color: 'red', marginBottom: '1rem', fontSize: '0.875rem' }}>{error}</p>}

        {/* School ID field only shown when subdomain isn't detected (local dev) */}
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
      </form>
    </div>
  )
}
