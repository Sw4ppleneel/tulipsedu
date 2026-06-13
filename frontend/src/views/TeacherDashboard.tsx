import { useEffect, useState } from 'preact/hooks'
import { teacherApi } from '../api/teacher'
import type { AttendanceStatus, TeacherDashboard } from '../api/teacher'

const STATUS_PILL: Record<AttendanceStatus, { label: string; bg: string; color: string }> = {
  none:      { label: 'Not marked', bg: '#fef2f2', color: '#b91c1c' },
  draft:     { label: 'Draft',      bg: '#fffbeb', color: '#b45309' },
  submitted: { label: 'Submitted',  bg: '#ecfdf5', color: '#14463A' },
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

const CARD: preact.JSX.CSSProperties = {
  background: '#fff', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,.07)',
  overflow: 'hidden', marginBottom: '1rem',
}
const CARD_HEAD: preact.JSX.CSSProperties = {
  padding: '.7rem 1rem', borderBottom: '1px solid #f3f4f6', fontSize: '.7rem',
  fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: '#6b7280',
}

export function TeacherDashboard({ onGoToAttendance }: { onGoToAttendance: () => void }) {
  const [data, setData] = useState<TeacherDashboard | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    teacherApi.dashboard().then(setData).catch(e => setErr(e instanceof Error ? e.message : 'Failed to load'))
  }, [])

  if (err) return <div style={{ padding: '2rem', textAlign: 'center', color: '#ef4444' }}>{err}</div>
  if (!data) return <div style={{ padding: '3rem', textAlign: 'center', color: '#9ca3af' }}>Loading…</div>

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '1rem' }}>
      {/* Pending attendance — the day's primary action */}
      <div style={CARD}>
        <div style={CARD_HEAD}>
          Pending Attendance · {data.pending_attendance.length} of {data.classes.length}
        </div>
        {data.classes.length === 0 ? (
          <div style={{ padding: '1.5rem 1rem', textAlign: 'center', color: '#6b7280', fontSize: '.85rem' }}>
            No classes assigned to you yet. Contact the office.
          </div>
        ) : (
          data.classes.map(c => {
            const pill = STATUS_PILL[c.attendance_today]
            return (
              <div key={`${c.class_id}-${c.section_id}`} style={{ display: 'flex', alignItems: 'center', gap: '.6rem', padding: '.6rem 1rem', borderBottom: '1px solid #f9fafb' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '.85rem', color: '#111827' }}>
                    {c.class_name} {c.section_name}
                    {c.is_class_teacher && <span style={{ marginLeft: '.4rem', fontSize: '.6rem', background: '#EDF3EE', color: '#14463A', borderRadius: 9999, padding: '1px 6px', fontWeight: 700 }}>CLASS TEACHER</span>}
                  </div>
                  <div style={{ fontSize: '.7rem', color: '#9ca3af' }}>{c.subject || '—'}</div>
                </div>
                <span style={{ ...pill, fontSize: '.62rem', fontWeight: 700, borderRadius: 9999, padding: '2px 8px' }}>{pill.label}</span>
                {c.attendance_today !== 'submitted' && (
                  <button onClick={onGoToAttendance} style={{ background: '#14463A', color: '#fff', border: 'none', borderRadius: 6, padding: '.35rem .7rem', fontSize: '.72rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Mark
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Recent homework */}
      <div style={CARD}>
        <div style={CARD_HEAD}>Recent Homework</div>
        {data.recent_homework.length === 0 ? (
          <div style={{ padding: '1.1rem', textAlign: 'center', color: '#9ca3af', fontSize: '.8rem' }}>Nothing posted recently</div>
        ) : data.recent_homework.map(h => (
          <div key={h.id} style={{ padding: '.55rem 1rem', borderBottom: '1px solid #f9fafb' }}>
            <div style={{ fontSize: '.82rem', fontWeight: 600, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.title}</div>
            <div style={{ fontSize: '.7rem', color: '#6b7280' }}>
              {h.class_name} {h.section_name}{h.subject ? ` · ${h.subject}` : ''}{h.due_date ? ` · due ${fmtDate(h.due_date)}` : ''}
            </div>
          </div>
        ))}
      </div>

      {/* Notices + upcoming exams, side by side on wide screens */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ ...CARD, flex: '1 1 240px' }}>
          <div style={CARD_HEAD}>Recent Notices</div>
          {data.recent_notices.length === 0 ? (
            <div style={{ padding: '1.1rem', textAlign: 'center', color: '#9ca3af', fontSize: '.8rem' }}>No notices</div>
          ) : data.recent_notices.map(n => (
            <div key={n.id} style={{ padding: '.55rem 1rem', borderBottom: '1px solid #f9fafb' }}>
              <div style={{ fontSize: '.8rem', fontWeight: 600, color: '#111827' }}>{n.title}</div>
              <div style={{ fontSize: '.68rem', color: '#9ca3af' }}>{n.scope} · {fmtDate(n.created_at)}</div>
            </div>
          ))}
        </div>
        <div style={{ ...CARD, flex: '1 1 240px' }}>
          <div style={CARD_HEAD}>Upcoming Exams</div>
          {data.upcoming_exams.length === 0 ? (
            <div style={{ padding: '1.1rem', textAlign: 'center', color: '#9ca3af', fontSize: '.8rem' }}>None scheduled</div>
          ) : data.upcoming_exams.map(e => (
            <div key={e.id} style={{ padding: '.55rem 1rem', borderBottom: '1px solid #f9fafb' }}>
              <div style={{ fontSize: '.8rem', fontWeight: 600, color: '#111827' }}>{e.name}</div>
              <div style={{ fontSize: '.68rem', color: '#9ca3af' }}>{fmtDate(e.start_date)} – {fmtDate(e.end_date)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
