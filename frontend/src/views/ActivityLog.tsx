import { useEffect, useState } from 'preact/hooks'
import { getActivityLog, getActivityLogCategories } from '../api/activity_log'
import type { ActivityLogEntry } from '../api/activity_log'
import { Spinner, EmptyState } from '../ui'

// Color by category (not per exact event type — there are 30+ event types
// and growing; hand-mapping each one doesn't scale) so the log stays visually
// scannable without needing every new event type registered here too.
const CATEGORY_COLORS: Record<string, { bg: string; color: string }> = {
  students: { bg: '#e0e7ff', color: '#3730a3' },
  fees: { bg: '#fff7ed', color: '#7c2d12' },
  homework: { bg: '#fef9c3', color: '#854d0e' },
  attendance: { bg: '#dcfce7', color: '#166534' },
  exams: { bg: '#fce7f3', color: '#9d174d' },
  staff: { bg: '#EDF3EE', color: '#14463A' },
  payroll: { bg: '#e0f2fe', color: '#0369a1' },
  admissions: { bg: '#f3e8ff', color: '#6b21a8' },
  academic: { bg: '#f1f5f9', color: '#334155' },
}

const CATEGORY_LABELS: Record<string, string> = {
  students: 'Students', fees: 'Fees', homework: 'Homework', attendance: 'Attendance',
  exams: 'Exams', staff: 'Staff', payroll: 'Payroll', admissions: 'Admissions', academic: 'Academic',
}

// "STAFF_ROLE_ASSIGNED" -> "Staff Role Assigned" — a readable label for any
// event type without needing every one hand-registered.
function typeLabel(eventType: string): string {
  return eventType.toLowerCase().split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')
}

function fmt(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function ActivityLogView() {
  const [entries, setEntries] = useState<ActivityLogEntry[] | null>(null)
  const [categories, setCategories] = useState<string[]>([])
  const [category, setCategory] = useState<string>('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [offset, setOffset] = useState(0)
  const PAGE = 50

  useEffect(() => { getActivityLogCategories().then(r => setCategories(r.categories)).catch(() => {}) }, [])

  function load(nextOffset: number, cat: string) {
    setLoading(true)
    getActivityLog(PAGE, nextOffset, cat || undefined)
      .then((rows) => { setEntries(rows); setOffset(nextOffset) })
      .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load(0, category) }, [category])

  return (
    <div style={{ padding: '1.5rem', maxWidth: 900, margin: '0 auto' }}>
      <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.25rem', fontWeight: 700 }}>Activity Log</h2>
      <p style={{ margin: '0 0 1rem', fontSize: '0.8rem', color: '#6b7280' }}>
        Every recorded staff action — who did what, and when.
      </p>

      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <button onClick={() => setCategory('')}
          style={{ padding: '0.3rem 0.75rem', borderRadius: 9999, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', border: category === '' ? '1px solid transparent' : '1px solid #d1d5db', background: category === '' ? '#14463A' : '#fff', color: category === '' ? '#fff' : '#374151' }}>
          All
        </button>
        {categories.map((c) => (
          <button key={c} onClick={() => setCategory(c)}
            style={{ padding: '0.3rem 0.75rem', borderRadius: 9999, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', border: category === c ? '1px solid transparent' : '1px solid #d1d5db', background: category === c ? '#14463A' : '#fff', color: category === c ? '#fff' : '#374151' }}>
            {CATEGORY_LABELS[c] ?? c}
          </button>
        ))}
      </div>

      {err && <p style={{ color: '#c00', fontSize: '0.875rem' }}>{err}</p>}
      {!entries && !err && <Spinner label="Loading…" />}
      {entries && entries.length === 0 && (
        <EmptyState title="No activity yet" hint="Recorded actions will show up here." />
      )}

      {entries && entries.length > 0 && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ display: 'flex', padding: '0 1rem', height: 36, background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontSize: '0.72rem', fontWeight: 600, color: '#6b7280', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ width: 160, flexShrink: 0 }}>ACTION</span>
            <span style={{ width: 180, flexShrink: 0 }}>ABOUT</span>
            <span style={{ flex: 1 }}>DETAIL</span>
            <span style={{ width: 140, flexShrink: 0 }}>BY</span>
            <span style={{ width: 150, flexShrink: 0, textAlign: 'right' }}>WHEN</span>
          </div>
          {entries.map((e) => {
            const c = CATEGORY_COLORS[e.category] ?? { bg: '#f3f4f6', color: '#374151' }
            return (
              <div key={e.id} style={{ display: 'flex', padding: '0.55rem 1rem', borderBottom: '1px solid #f3f4f6', gap: '0.75rem', fontSize: '0.8rem', alignItems: 'center' }}>
                <span style={{ width: 160, flexShrink: 0 }}>
                  <span style={{ padding: '2px 7px', borderRadius: 9999, fontSize: '0.68rem', fontWeight: 600, background: c.bg, color: c.color, whiteSpace: 'nowrap' }}>
                    {typeLabel(e.event_type)}
                  </span>
                </span>
                <span style={{ width: 180, flexShrink: 0, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.subject_name ?? '—'}</span>
                <span style={{ flex: 1, color: '#374151' }}>{e.summary}</span>
                <span style={{ width: 140, flexShrink: 0, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.actor_name}</span>
                <span style={{ width: 150, flexShrink: 0, textAlign: 'right', color: '#9ca3af', fontSize: '0.72rem' }}>{fmt(e.created_at)}</span>
              </div>
            )
          })}
        </div>
      )}

      {entries && (
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', justifyContent: 'flex-end' }}>
          <button onClick={() => load(Math.max(0, offset - PAGE), category)} disabled={loading || offset === 0}
            style={{ padding: '0.35rem 0.8rem', background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', fontSize: '0.78rem' }}>
            ← Newer
          </button>
          <button onClick={() => load(offset + PAGE, category)} disabled={loading || entries.length < PAGE}
            style={{ padding: '0.35rem 0.8rem', background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', fontSize: '0.78rem' }}>
            Older →
          </button>
        </div>
      )}
    </div>
  )
}
