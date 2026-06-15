import { useEffect, useState } from 'preact/hooks'
import { request } from '../api/client'

interface TrendDay { date: string; present: number; absent: number; total: number }
interface ClassRecovery { class_name: string; collected: number; expected: number; rate_pct: number }
interface LowAtt { student_id: string; student_name: string; admission_no: string; class_name: string; section_name: string; pct: number }

interface DashboardStats {
  school_name: string
  total_students: number
  total_staff: number
  fee_outstanding: number
  fee_recovery: { collected: number; expected: number; rate_pct: number }
  defaulter_count: number
  payment_claims_pending: number
  oldest_claim_age_days: number
  class_recovery: ClassRecovery[]
  attendance_trend: TrendDay[]
  low_attendance: LowAtt[]
  recent_homework: {
    id: string; title: string; subject: string; post_type: string
    due_date: string | null; created_at: string; class_name: string; section_name: string
  }[]
}

const POST_BADGE: Record<string, string> = {
  homework: 'badge-blue',
  announcement: 'badge-yellow',
  resource: 'badge-green',
}

function fmt(n: number): string {
  if (n >= 10_00_000) return (n / 10_00_000).toFixed(1) + 'L'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

function fmtInr(n: number): string {
  return '₹' + n.toLocaleString('en-IN')
}

// ── Mini bar sparkline for attendance trend ───────────────────────────────────
function AttSparkline({ trend }: { trend: TrendDay[] }) {
  if (trend.length === 0) return <p style={{ color: '#9ca3af', fontSize: '0.8rem', textAlign: 'center', padding: '1.5rem' }}>No attendance data in the last 30 days.</p>
  const maxTotal = Math.max(...trend.map(d => d.total), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 52, paddingBottom: 2 }}>
      {trend.map((d) => {
        const barH = Math.max(4, Math.round(d.total / maxTotal * 48))
        const pct = d.total > 0 ? Math.round(d.present / d.total * 100) : 0
        const color = pct >= 85 ? '#1F8A5D' : pct >= 75 ? '#f59e0b' : '#dc2626'
        return (
          <div
            key={d.date}
            title={`${d.date}: ${pct}% present (${d.present}/${d.total})`}
            style={{ flex: 1, height: barH, background: color, borderRadius: '2px 2px 0 0', minWidth: 3 }}
          />
        )
      })}
    </div>
  )
}

// ── Fee recovery bar ──────────────────────────────────────────────────────────
function RecoveryBar({ pct, label, size = 'normal' }: { pct: number; label: string; size?: 'normal' | 'sm' }) {
  const color = pct >= 80 ? '#1F8A5D' : pct >= 60 ? '#f59e0b' : '#dc2626'
  const h = size === 'sm' ? 6 : 10
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: size === 'sm' ? '0.72rem' : '0.8rem', marginBottom: 3, color: '#374151' }}>
        <span>{label}</span>
        <span style={{ fontWeight: 700, color }}>{pct.toFixed(1)}%</span>
      </div>
      <div style={{ background: '#e5e7eb', borderRadius: 999, height: h, overflow: 'hidden' }}>
        <div style={{ height: h, width: `${Math.min(pct, 100)}%`, background: color, borderRadius: 999, transition: 'width 0.4s' }} />
      </div>
    </div>
  )
}

export function DashboardView({ schoolName, role }: { schoolName: string; role?: string }) {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    request<DashboardStats>('/dashboard')
      .then(setStats)
      .catch(e => setErr(e instanceof Error ? e.message : 'Failed to load'))
  }, [])

  const isPrincipal = role === 'principal' || role === 'vice_principal'

  const greeting = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  }

  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div class="page">
      {/* Welcome header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <p class="text-muted text-sm" style={{ marginBottom: '.2rem' }}>{today}</p>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--gray-900)' }}>
          {greeting()}, {stats?.school_name || schoolName}
        </h2>
      </div>

      {err && <p class="err" style={{ marginBottom: '1rem' }}>{err}</p>}

      {/* Stat cards */}
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-icon">🎓</div>
          <div class="stat-label">Students</div>
          <div class="stat-value" style={{ color: 'var(--c-primary)' }}>
            {stats ? fmt(stats.total_students) : '—'}
          </div>
          <div class="stat-sub">enrolled &amp; active</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">👩‍🏫</div>
          <div class="stat-label">Staff</div>
          <div class="stat-value" style={{ color: 'var(--c-success)' }}>
            {stats ? fmt(stats.total_staff) : '—'}
          </div>
          <div class="stat-sub">active members</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">💰</div>
          <div class="stat-label">Fee Outstanding</div>
          <div class="stat-value" style={{ color: stats && stats.fee_outstanding > 0 ? 'var(--c-danger)' : 'var(--c-success)', fontSize: stats && stats.fee_outstanding > 99_999 ? '1.35rem' : '1.75rem' }}>
            {stats ? fmtInr(stats.fee_outstanding) : '—'}
          </div>
          <div class="stat-sub">pending collection</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">⚠️</div>
          <div class="stat-label">Defaulters</div>
          <div class="stat-value" style={{ color: stats && stats.defaulter_count > 0 ? 'var(--c-danger)' : 'var(--c-success)' }}>
            {stats ? fmt(stats.defaulter_count) : '—'}
          </div>
          <div class="stat-sub">overdue payments</div>
        </div>
        {stats && stats.payment_claims_pending > 0 && (
          <div class="stat-card" style={{ borderLeft: '3px solid #dc2626', background: '#fff5f5' }}>
            <div class="stat-icon">🔴</div>
            <div class="stat-label">To Verify</div>
            <div class="stat-value" style={{ color: '#dc2626' }}>
              {stats.payment_claims_pending}
            </div>
            <div class="stat-sub">
              {stats.oldest_claim_age_days > 0 ? `oldest ${stats.oldest_claim_age_days}d` : 'payment claims'}
            </div>
          </div>
        )}
      </div>

      {/* Analytics panels — principal/VP only */}
      {isPrincipal && stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
          {/* Fee recovery */}
          <div class="card" style={{ padding: '1rem 1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.875rem' }}>
              <span style={{ fontWeight: 700, fontSize: '.875rem' }}>Fee Recovery</span>
              <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>{fmtInr(stats.fee_recovery.collected)} of {fmtInr(stats.fee_recovery.expected)}</span>
            </div>
            <RecoveryBar pct={stats.fee_recovery.rate_pct} label="School-wide" />
            {stats.class_recovery.length > 0 && (
              <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {stats.class_recovery.slice(0, 5).map((c) => (
                  <RecoveryBar key={c.class_name} pct={c.rate_pct} label={c.class_name} size="sm" />
                ))}
              </div>
            )}
          </div>

          {/* Attendance trend */}
          <div class="card" style={{ padding: '1rem 1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.875rem' }}>
              <span style={{ fontWeight: 700, fontSize: '.875rem' }}>Attendance (30 days)</span>
              <span style={{ fontSize: '0.72rem', color: '#6b7280' }}>
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#1F8A5D', marginRight: 4 }} />≥85%
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#f59e0b', marginLeft: 6, marginRight: 4 }} />≥75%
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#dc2626', marginLeft: 6, marginRight: 4 }} />&lt;75%
              </span>
            </div>
            <AttSparkline trend={stats.attendance_trend} />
          </div>
        </div>
      )}

      {/* Accountant: fee recovery card only */}
      {!isPrincipal && stats && (
        <div class="card" style={{ padding: '1rem 1.25rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.625rem' }}>
            <span style={{ fontWeight: 700, fontSize: '.875rem' }}>Fee Recovery</span>
            <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>{fmtInr(stats.fee_recovery.collected)} collected</span>
          </div>
          <RecoveryBar pct={stats.fee_recovery.rate_pct} label="School-wide" />
        </div>
      )}

      {/* Low attendance alert — principal/VP only */}
      {isPrincipal && stats && stats.low_attendance.length > 0 && (
        <div class="card" style={{ marginBottom: '1rem' }}>
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--gray-200)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, fontSize: '.875rem', color: '#dc2626' }}>Low Attendance Alert (&lt;75%)</span>
            <span class="text-muted text-xs">{stats.low_attendance.length} student{stats.low_attendance.length !== 1 ? 's' : ''}</span>
          </div>
          {stats.low_attendance.slice(0, 15).map((s, i) => (
            <div key={s.student_id} style={{ display: 'flex', alignItems: 'center', gap: '.875rem', padding: '.625rem 1.25rem', borderBottom: i < Math.min(stats.low_attendance.length, 15) - 1 ? '1px solid var(--gray-100)' : 'none' }}>
              <span style={{ width: 38, height: 38, borderRadius: '50%', background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 800, color: '#dc2626', flexShrink: 0 }}>
                {s.pct.toFixed(0)}%
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.student_name}</div>
                <div class="text-muted text-xs">{s.class_name} {s.section_name} · {s.admission_no}</div>
              </div>
            </div>
          ))}
          {stats.low_attendance.length > 15 && (
            <div style={{ padding: '0.5rem 1.25rem', fontSize: '0.75rem', color: '#9ca3af', textAlign: 'center' }}>
              +{stats.low_attendance.length - 15} more — view full list in Attendance module
            </div>
          )}
        </div>
      )}

      {/* Recent homework */}
      {isPrincipal && (
        <div class="card">
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--gray-200)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, fontSize: '.875rem' }}>Recent Feed Activity</span>
            <span class="text-muted text-xs">Latest 6 posts</span>
          </div>
          {!stats && !err && (
            <div class="empty-state">Loading…</div>
          )}
          {stats && stats.recent_homework.length === 0 && (
            <div class="empty-state">No recent posts. Use Homework tab to create one.</div>
          )}
          {stats && stats.recent_homework.map((h, i) => (
            <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: '.875rem', padding: '.75rem 1.25rem', borderBottom: i < stats.recent_homework.length - 1 ? '1px solid var(--gray-100)' : 'none' }}>
              <span class={`badge ${POST_BADGE[h.post_type] ?? 'badge-gray'}`}>
                {h.post_type.toUpperCase()}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.title}</div>
                <div class="text-muted text-xs">
                  {h.subject} · {h.class_name} {h.section_name}
                  {h.due_date ? ` · Due ${h.due_date}` : ''}
                </div>
              </div>
              <div class="text-muted text-xs" style={{ flexShrink: 0 }}>
                {new Date(h.created_at).toLocaleDateString('en-IN')}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
