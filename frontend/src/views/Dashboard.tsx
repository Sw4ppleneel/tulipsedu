import { useEffect, useState } from 'preact/hooks'
import { request } from '../api/client'

interface DashboardStats {
  school_name: string
  total_students: number
  total_staff: number
  fee_outstanding: number
  recent_homework: {
    id: string
    title: string
    subject: string
    post_type: string
    due_date: string | null
    created_at: string
    class_name: string
    section_name: string
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

export function DashboardView({ schoolName }: { schoolName: string }) {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    request<DashboardStats>('/dashboard')
      .then(setStats)
      .catch(e => setErr(e instanceof Error ? e.message : 'Failed to load'))
  }, [])

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
          <div class="stat-icon">📚</div>
          <div class="stat-label">Homework Posts</div>
          <div class="stat-value" style={{ color: 'var(--c-warn)' }}>
            {stats ? fmt(stats.recent_homework.length) : '—'}
          </div>
          <div class="stat-sub">recent 7 days</div>
        </div>
      </div>

      {/* Recent homework */}
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
    </div>
  )
}
