import { useEffect, useState } from 'preact/hooks'
import { getActivityLog } from '../api/activity_log'
import type { ActivityLogEntry } from '../api/activity_log'
import { Spinner, EmptyState } from '../ui'

const TYPE_LABELS: Record<string, string> = {
  STUDENT_UPDATED: 'Student Edited',
  FEE_WAIVED: 'Fee Waived',
  STUDENT_DISCOUNT_SET: 'Discount Changed',
}
const TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  STUDENT_UPDATED: { bg: '#e0e7ff', color: '#3730a3' },
  FEE_WAIVED: { bg: '#fff7ed', color: '#7c2d12' },
  STUDENT_DISCOUNT_SET: { bg: '#EDF3EE', color: '#14463A' },
}

function fmt(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function ActivityLogView() {
  const [entries, setEntries] = useState<ActivityLogEntry[] | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [offset, setOffset] = useState(0)
  const PAGE = 50

  function load(nextOffset: number) {
    setLoading(true)
    getActivityLog(PAGE, nextOffset)
      .then((rows) => { setEntries(rows); setOffset(nextOffset) })
      .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load(0) }, [])

  return (
    <div style={{ padding: '1.5rem', maxWidth: 900, margin: '0 auto' }}>
      <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.25rem', fontWeight: 700 }}>Activity Log</h2>
      <p style={{ margin: '0 0 1rem', fontSize: '0.8rem', color: '#6b7280' }}>
        Student edits, fee waivers, and discount changes — who did what, and when.
      </p>

      {err && <p style={{ color: '#c00', fontSize: '0.875rem' }}>{err}</p>}
      {!entries && !err && <Spinner label="Loading…" />}
      {entries && entries.length === 0 && (
        <EmptyState title="No activity yet" hint="Edits, waivers, and discount changes will show up here." />
      )}

      {entries && entries.length > 0 && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ display: 'flex', padding: '0 1rem', height: 36, background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontSize: '0.72rem', fontWeight: 600, color: '#6b7280', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ width: 130, flexShrink: 0 }}>TYPE</span>
            <span style={{ width: 200, flexShrink: 0 }}>STUDENT</span>
            <span style={{ flex: 1 }}>DETAIL</span>
            <span style={{ width: 140, flexShrink: 0 }}>BY</span>
            <span style={{ width: 150, flexShrink: 0, textAlign: 'right' }}>WHEN</span>
          </div>
          {entries.map((e) => {
            const c = TYPE_COLORS[e.event_type] ?? { bg: '#f3f4f6', color: '#374151' }
            return (
              <div key={e.id} style={{ display: 'flex', padding: '0.55rem 1rem', borderBottom: '1px solid #f3f4f6', gap: '0.75rem', fontSize: '0.8rem', alignItems: 'center' }}>
                <span style={{ width: 130, flexShrink: 0 }}>
                  <span style={{ padding: '2px 7px', borderRadius: 9999, fontSize: '0.68rem', fontWeight: 600, background: c.bg, color: c.color, whiteSpace: 'nowrap' }}>
                    {TYPE_LABELS[e.event_type] ?? e.event_type}
                  </span>
                </span>
                <span style={{ width: 200, flexShrink: 0, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.student_name ?? '—'}</span>
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
          <button onClick={() => load(Math.max(0, offset - PAGE))} disabled={loading || offset === 0}
            style={{ padding: '0.35rem 0.8rem', background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', fontSize: '0.78rem' }}>
            ← Newer
          </button>
          <button onClick={() => load(offset + PAGE)} disabled={loading || entries.length < PAGE}
            style={{ padding: '0.35rem 0.8rem', background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', fontSize: '0.78rem' }}>
            Older →
          </button>
        </div>
      )}
    </div>
  )
}
