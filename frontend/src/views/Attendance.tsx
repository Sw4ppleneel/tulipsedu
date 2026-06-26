import { useEffect, useRef, useState } from 'preact/hooks'
import { markAttendance, openSession, submitSession } from '../api/attendance'
import { listAcademicYears, listClasses, listStudents } from '../api/students'
import { getAssignedClasses } from '../api/teacher'
import { enqueue, dequeueAll } from '../db/idb'
import type { AcademicYear, Class, Section, Student } from '../types/student'
import type { AttendanceMark, AttendanceSession, AttendanceStatus } from '../types/attendance'

type Marks = Record<string, AttendanceStatus>

const STATUS_COLOR: Record<AttendanceStatus, string> = { P: '#15803d', L: '#b45309', A: '#dc2626' }
const STATUS_BG: Record<AttendanceStatus, string>    = { P: '#dcfce7', L: '#fef3c7', A: '#fee2e2' }

function StatusBtn({ status, active, onClick }: { status: AttendanceStatus; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 36, height: 30, border: 'none', borderRadius: 4, cursor: 'pointer',
        fontWeight: 700, fontSize: '0.8rem',
        background: active ? STATUS_BG[status] : '#f3f4f6',
        color: active ? STATUS_COLOR[status] : '#9ca3af',
        outline: active ? `2px solid ${STATUS_COLOR[status]}` : 'none',
        outlineOffset: '-2px',
      }}
    >
      {status}
    </button>
  )
}

function StudentMarkRow({ student, mark, onChange }: { student: Student; mark: AttendanceStatus | null; onChange: (s: AttendanceStatus) => void }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', padding: '0.5rem 1rem',
      borderBottom: '1px solid #f3f4f6', gap: '0.75rem', background: '#fff',
      transition: 'background 0.1s',
    }}>
      <span style={{ width: 44, fontWeight: 700, color: '#14463A', fontSize: '0.8rem', flexShrink: 0 }}>#{student.roll_number}</span>
      <span style={{ flex: 1, fontSize: '0.875rem' }}>{student.first_name} {student.last_name}</span>
      {mark && (
        <span style={{ padding: '1px 8px', background: STATUS_BG[mark], color: STATUS_COLOR[mark], borderRadius: 9999, fontSize: '0.7rem', fontWeight: 700 }}>
          {mark === 'P' ? 'Present' : mark === 'A' ? 'Absent' : 'Late'}
        </span>
      )}
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        <StatusBtn status="P" active={mark === 'P'} onClick={() => onChange('P')} />
        <StatusBtn status="L" active={mark === 'L'} onClick={() => onChange('L')} />
        <StatusBtn status="A" active={mark === 'A'} onClick={() => onChange('A')} />
      </div>
    </div>
  )
}

export function AttendanceView({ role }: { role?: string }) {
  const isTeacher = role === 'teacher' || role === 'class_teacher'
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [yearId, setYearId]     = useState('')
  const [classId, setClassId]   = useState('')
  const [sectionId, setSectionId] = useState('')
  const [dateStr, setDateStr]   = useState(() => new Date().toISOString().split('T')[0])
  const [session, setSession]   = useState<AttendanceSession | null>(null)
  const [students, setStudents] = useState<Student[]>([])
  const [marks, setMarks]       = useState<Marks>({})
  const [loading, setLoading]   = useState(false)
  const [syncing, setSyncing]   = useState(false)
  const [online, setOnline]     = useState(navigator.onLine)
  const [queued, setQueued]     = useState(0)
  const [submitted, setSubmitted] = useState(false)
  const [editing, setEditing]   = useState(false)
  const [error, setError]       = useState('')

  // A submitted session is read-only until the teacher explicitly chooses to correct it.
  const locked = submitted && !editing

  const pendingRef = useRef<Marks>({})

  // Track online status
  useEffect(() => {
    const up = () => setOnline(true)
    const dn = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', dn)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', dn) }
  }, [])

  // Load years + classes on mount; teachers only see their assigned classes
  useEffect(() => {
    const classLoader = isTeacher
      ? getAssignedClasses() as Promise<Class[]>
      : listClasses()
    Promise.all([listAcademicYears(), classLoader]).then(([ys, cs]) => {
      setAcademicYears(ys)
      setClasses(cs)
      const cur = ys.find((y) => y.is_current)
      if (cur) setYearId(cur.id)
    })
  }, [])

  // Flush offline queue when back online
  useEffect(() => {
    if (online && session) flushQueue()
  }, [online, session])

  const sections: Section[] = classes.find((c) => c.id === classId)?.sections ?? []

  function resetSession() {
    setSession(null)
    setStudents([])
    setMarks({})
    setSubmitted(false)
    setEditing(false)
  }

  async function handleOpenSession() {
    if (!yearId || !classId || !sectionId || !dateStr) return
    setLoading(true)
    setError('')
    try {
      const [sess, studs] = await Promise.all([
        openSession({ academic_year_id: yearId, class_id: classId, section_id: sectionId, date: dateStr }),
        listStudents({ academic_year_id: yearId, class_id: classId, section_id: sectionId, limit: 500 }),
      ])
      setSession(sess)
      setSubmitted(sess.submitted)
      setEditing(false)
      setStudents(studs.items)

      // Load existing marks from the session detail
      const { getSessionDetail } = await import('../api/attendance')
      const detail = await getSessionDetail(sess.id)
      const existing: Marks = {}
      for (const r of detail.records) existing[r.student_id] = r.status as AttendanceStatus
      setMarks(existing)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open session')
    } finally {
      setLoading(false)
    }
  }

  async function handleMark(studentId: string, status: AttendanceStatus) {
    setMarks((prev) => ({ ...prev, [studentId]: status }))
    const mark: AttendanceMark = { student_id: studentId, status }

    if (!session) return

    if (online) {
      try {
        await markAttendance(session.id, [mark])
      } catch {
        // If sync fails, queue it
        await enqueue('attendance_queue', { session_id: session.id, marks: [mark] })
        setQueued((q) => q + 1)
      }
    } else {
      await enqueue('attendance_queue', { session_id: session.id, marks: [mark] })
      setQueued((q) => q + 1)
    }
  }

  async function flushQueue() {
    if (!session || syncing) return
    const items = await dequeueAll('attendance_queue') as Array<{ session_id: string; marks: AttendanceMark[] }>
    if (!items.length) { setQueued(0); return }

    setSyncing(true)
    try {
      // Batch items by session; merge into latest mark per student
      const merged: Record<string, AttendanceMark> = {}
      for (const item of items) {
        for (const m of item.marks) merged[m.student_id] = m
      }
      await markAttendance(session.id, Object.values(merged))
      setQueued(0)
    } catch {
      // Re-enqueue if flush fails
    } finally {
      setSyncing(false)
    }
  }

  async function markAllPresent() {
    if (!session) return
    const allMarks = students.map((s) => ({ student_id: s.id, status: 'P' as AttendanceStatus }))
    const newMarks: Marks = {}
    for (const s of students) newMarks[s.id] = 'P'
    setMarks(newMarks)
    if (online) {
      await markAttendance(session.id, allMarks).catch(() => {})
    } else {
      for (const m of allMarks) await enqueue('attendance_queue', { session_id: session.id, marks: [m] })
      setQueued(students.length)
    }
  }

  async function handleSubmit() {
    if (!session) return
    try {
      await submitSession(session.id)
      setSubmitted(true)
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submit failed')
    }
  }

  const marked = Object.keys(marks).length
  const total  = students.length
  const pct    = total ? Math.round((marked / total) * 100) : 0

  const SEL: preact.JSX.CSSProperties = { padding: '0.375rem 0.625rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.8rem', background: '#fff' }

  return (
    <div style={{ padding: '1.5rem', fontFamily: 'system-ui, sans-serif', maxWidth: 700 }}>
      <h2 style={{ margin: '0 0 1rem', fontSize: '1.25rem', fontWeight: 700 }}>Attendance</h2>

      {/* Offline banner */}
      {!online && (
        <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 6, padding: '0.5rem 0.875rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: '#92400e', display: 'flex', justifyContent: 'space-between' }}>
          <span>Offline — marks saved locally</span>
          {queued > 0 && <span>{queued} mark{queued !== 1 ? 's' : ''} queued</span>}
        </div>
      )}
      {online && queued > 0 && (
        <div style={{ background: '#d1fae5', border: '1px solid #6ee7b7', borderRadius: 6, padding: '0.5rem 0.875rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: '#0D332A' }}>
          {syncing ? 'Syncing…' : `${queued} offline mark${queued !== 1 ? 's' : ''} synced ✓`}
        </div>
      )}

      {/* Session selector */}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.625rem', alignItems: 'flex-end' }}>
          <select value={yearId} onChange={(e) => { setYearId((e.target as HTMLSelectElement).value); resetSession() }} style={SEL}>
            <option value="">Year</option>
            {academicYears.map((y) => <option key={y.id} value={y.id}>{y.name}{y.is_current ? ' ★' : ''}</option>)}
          </select>
          <select value={classId} onChange={(e) => { setClassId((e.target as HTMLSelectElement).value); setSectionId(''); resetSession() }} style={SEL}>
            <option value="">Class</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={sectionId} onChange={(e) => { setSectionId((e.target as HTMLSelectElement).value); resetSession() }} style={{ ...SEL, minWidth: 80 }} disabled={!classId}>
            <option value="">Section</option>
            {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input type="date" value={dateStr} onChange={(e) => { setDateStr((e.target as HTMLInputElement).value); resetSession() }} style={SEL} />
          <button
            onClick={handleOpenSession}
            disabled={!yearId || !classId || !sectionId || !dateStr || loading}
            style={{ padding: '0.375rem 0.875rem', background: '#14463A', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' }}
          >
            {loading ? 'Loading…' : session ? 'Reload' : 'Start'}
          </button>
        </div>
      </div>

      {error && <p style={{ color: '#c00', fontSize: '0.875rem', marginBottom: '0.75rem' }}>{error}</p>}

      {session && (
        <>
          {/* Progress bar */}
          <div style={{ marginBottom: '0.875rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.25rem' }}>
              <span>
                {session.class_name} — {session.section_name} | {session.date}
                {session.marked_by_name && (
                  <span style={{ color: '#9ca3af', marginLeft: '0.5rem' }}>
                    · Marked by {session.marked_by_name}
                  </span>
                )}
              </span>
              <span>{marked}/{total} marked ({pct}%)</span>
            </div>
            <div style={{ height: 4, background: '#e5e7eb', borderRadius: 2 }}>
              <div style={{ height: 4, background: '#14463A', borderRadius: 2, width: `${pct}%`, transition: 'width 0.2s' }} />
            </div>
          </div>

          {/* Action row — available before submit, and while correcting a submitted session */}
          {!locked && (
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', alignItems: 'center' }}>
              <button onClick={markAllPresent} style={{ padding: '0.375rem 0.875rem', background: '#dcfce7', color: '#15803d', border: '1px solid #86efac', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>
                Mark All Present
              </button>
              <button
                onClick={handleSubmit}
                disabled={marked === 0}
                style={{ padding: '0.375rem 0.875rem', background: marked > 0 ? '#14463A' : '#e5e7eb', color: marked > 0 ? '#fff' : '#9ca3af', border: 'none', borderRadius: 4, cursor: marked > 0 ? 'pointer' : 'default', fontSize: '0.8rem', fontWeight: 600 }}
              >
                {editing ? 'Save corrections' : 'Submit'}
              </button>
              {editing && (
                <span style={{ fontSize: '0.75rem', color: '#b45309', fontWeight: 600 }}>
                  Correcting submitted attendance — changes save as you tap
                </span>
              )}
            </div>
          )}

          {locked && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.75rem' }}>
              <div style={{ padding: '0.5rem 0.875rem', background: '#d1fae5', borderRadius: 6, fontSize: '0.8rem', color: '#0D332A', fontWeight: 600 }}>
                ✓ Session submitted
              </div>
              <button
                onClick={() => setEditing(true)}
                style={{ padding: '0.375rem 0.875rem', background: '#fff', color: '#14463A', border: '1px solid #14463A', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
              >
                Edit / Correct
              </button>
            </div>
          )}

          {/* Student list */}
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '0 1rem', height: 32, background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', gap: '0.75rem' }}>
              <span style={{ width: 44, flexShrink: 0 }}>ROLL</span>
              <span style={{ flex: 1 }}>NAME</span>
              <span style={{ width: 80, flexShrink: 0 }}></span>
              <span style={{ width: 116, flexShrink: 0, textAlign: 'right' }}>P / L / A</span>
            </div>
            <div style={{ maxHeight: 520, overflowY: 'auto' }}>
              {students.map((s) => (
                <StudentMarkRow
                  key={s.id}
                  student={s}
                  mark={marks[s.id] ?? null}
                  onChange={(status) => !locked && handleMark(s.id, status)}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
