import { useEffect, useState } from 'preact/hooks'
import { getClassTimetable, upsertSlot, deleteSlot } from '../api/timetable'
import { listAcademicYears, listClasses } from '../api/students'
import { getSectionLabel } from '../api/auth_state'
import { listStaff } from '../api/staff'
import type { WeeklyTimetable, TimetableSlot, SlotUpsert } from '../api/timetable'
import type { AcademicYear, Class, Section } from '../types/student'
import type { Staff } from '../types/staff'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_NUMS = [1, 2, 3, 4, 5, 6]
const MIN_PERIODS = 8

const CELL: preact.JSX.CSSProperties = {
  border: '1px solid #e5e7eb', padding: '0.4rem', minHeight: 64,
  fontSize: '0.75rem', verticalAlign: 'top', cursor: 'pointer',
}

// ── Slot modal ────────────────────────────────────────────────────────────────

interface ModalState {
  day: number
  period: number
  existing?: TimetableSlot
}

function SlotModal({
  state, ay, cls, sec, staff, onSave, onDelete, onClose,
}: {
  state: ModalState
  ay: string; cls: string; sec: string
  staff: Staff[]
  onSave: (d: SlotUpsert) => Promise<void>
  onDelete?: () => Promise<void>
  onClose: () => void
}) {
  const ex = state.existing
  const [subject, setSubject] = useState(ex?.subject ?? '')
  const [start, setStart] = useState(ex?.start_time?.slice(0, 5) ?? '08:00')
  const [end, setEnd] = useState(ex?.end_time?.slice(0, 5) ?? '08:45')
  const [staffId, setStaffId] = useState(ex?.staff_id ?? '')
  const [room, setRoom] = useState(ex?.room ?? '')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e: Event) {
    e.preventDefault()
    if (!subject.trim()) { setErr('Subject is required'); return }
    setSaving(true); setErr('')
    try {
      await onSave({
        academic_year_id: ay, class_id: cls, section_id: sec,
        day_of_week: state.day, period_number: state.period,
        start_time: start, end_time: end,
        subject: subject.trim(),
        staff_id: staffId || undefined,
        room: room.trim() || undefined,
      })
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error') }
    finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!onDelete) return
    setDeleting(true)
    try { await onDelete() } catch (e) { setErr(e instanceof Error ? e.message : 'Error') }
    finally { setDeleting(false) }
  }

  const INP: preact.JSX.CSSProperties = { padding: '0.4rem 0.5rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.8rem', width: '100%', boxSizing: 'border-box' }
  const LBL: preact.JSX.CSSProperties = { fontSize: '0.7rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 3 }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <form onSubmit={submit} style={{ background: '#fff', borderRadius: 10, padding: '1.25rem', width: '100%', maxWidth: 420, boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#111827' }}>
            {DAYS[state.day - 1]} · Period {state.period}
          </h3>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.1rem', cursor: 'pointer', color: '#9ca3af', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.625rem', marginBottom: '0.625rem' }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={LBL}>Subject *</label>
            <input value={subject} onInput={e => setSubject((e.target as HTMLInputElement).value)}
              style={INP} placeholder="e.g. Mathematics" autoFocus />
          </div>
          <div>
            <label style={LBL}>Start time</label>
            <input type="time" value={start} onInput={e => setStart((e.target as HTMLInputElement).value)} style={INP} />
          </div>
          <div>
            <label style={LBL}>End time</label>
            <input type="time" value={end} onInput={e => setEnd((e.target as HTMLInputElement).value)} style={INP} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={LBL}>Teacher</label>
            <select value={staffId} onChange={e => setStaffId((e.target as HTMLSelectElement).value)} style={INP}>
              <option value="">— Unassigned —</option>
              {staff.map(s => (
                <option key={s.id} value={s.id}>{s.first_name} {s.last_name}{s.designation ? ` · ${s.designation}` : ''}</option>
              ))}
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={LBL}>Room</label>
            <input value={room} onInput={e => setRoom((e.target as HTMLInputElement).value)} style={INP} placeholder="optional" />
          </div>
        </div>

        {err && <p style={{ color: '#ef4444', fontSize: '0.75rem', margin: '0 0 0.5rem' }}>{err}</p>}

        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="submit" disabled={saving} style={{ padding: '0.4rem 1rem', background: '#14463A', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>
              {saving ? 'Saving…' : ex ? 'Update' : 'Add Slot'}
            </button>
            <button type="button" onClick={onClose} style={{ padding: '0.4rem 0.875rem', background: 'none', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem', color: '#374151' }}>
              Cancel
            </button>
          </div>
          {ex && onDelete && (
            <button type="button" onClick={handleDelete} disabled={deleting}
              style={{ padding: '0.4rem 0.875rem', background: 'none', border: '1px solid #fca5a5', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem', color: '#ef4444' }}>
              {deleting ? 'Removing…' : 'Remove'}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

// ── Slot cell ─────────────────────────────────────────────────────────────────

function SlotCell({ slot, onClick }: { slot: TimetableSlot | undefined; onClick: () => void }) {
  if (!slot) {
    return (
      <td style={{ ...CELL, background: '#fafafa' }} onClick={onClick} title="Click to add">
        <div style={{ color: '#d1d5db', fontSize: '0.7rem', textAlign: 'center', paddingTop: 16 }}>+</div>
      </td>
    )
  }
  return (
    <td style={{ ...CELL, background: '#EDF3EE' }} onClick={onClick} title="Click to edit">
      <div style={{ fontWeight: 600, color: '#0D332A', marginBottom: 2 }}>{slot.subject}</div>
      {slot.staff_name && <div style={{ color: '#6b7280' }}>{slot.staff_name}</div>}
      {slot.room && <div style={{ color: '#9ca3af' }}>Rm {slot.room}</div>}
      <div style={{ color: '#9ca3af' }}>{slot.start_time.slice(0, 5)}–{slot.end_time.slice(0, 5)}</div>
    </td>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function TimetableView() {
  const [years, setYears] = useState<AcademicYear[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [staff, setStaff] = useState<Staff[]>([])
  const [ay, setAy] = useState('')
  const [cls, setCls] = useState('')
  const [sec, setSec] = useState('')
  const [timetable, setTimetable] = useState<WeeklyTimetable | null>(null)
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState<ModalState | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    Promise.all([listAcademicYears(), listClasses(), listStaff({ is_active: true, limit: 500 })]).then(([ay, cls, s]) => {
      setYears(ay)
      setClasses(cls)
      setStaff(s.items)
      const cur = ay.find(y => y.is_current)
      if (cur) setAy(cur.id)
    })
  }, [])

  const sections: Section[] = classes.find(c => c.id === cls)?.sections ?? []

  async function loadTimetable(ayId: string, clsId: string, secId: string) {
    if (!ayId || !clsId || !secId) return
    setLoading(true); setErr('')
    try {
      setTimetable(await getClassTimetable({ academic_year_id: ayId, class_id: clsId, section_id: secId }))
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to load') }
    finally { setLoading(false) }
  }

  function selectClass(clsId: string) {
    setCls(clsId); setSec(''); setTimetable(null)
  }

  function selectSection(secId: string) {
    setSec(secId)
    if (ay && cls && secId) loadTimetable(ay, cls, secId)
  }

  async function handleSave(data: SlotUpsert) {
    await upsertSlot(data)
    setModal(null)
    loadTimetable(ay, cls, sec)
  }

  async function handleDelete(slot: TimetableSlot) {
    await deleteSlot({ academic_year_id: ay, class_id: cls, section_id: sec, day_of_week: slot.day_of_week, period_number: slot.period_number })
    setModal(null)
    loadTimetable(ay, cls, sec)
  }

  const slotMap = new Map<string, TimetableSlot>()
  timetable?.slots.forEach(s => slotMap.set(`${s.day_of_week}-${s.period_number}`, s))

  const maxPeriod = timetable
    ? Math.max(MIN_PERIODS, ...timetable.slots.map(s => s.period_number))
    : MIN_PERIODS
  const periods = Array.from({ length: maxPeriod }, (_, i) => i + 1)

  const modalSlot = modal ? slotMap.get(`${modal.day}-${modal.period}`) : undefined

  return (
    <div style={{ maxWidth: 1000, margin: '1.5rem auto', padding: '0 1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#111827' }}>Timetable</h2>
      </div>

      <div style={{ display: 'flex', gap: '0.625rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <select value={ay} onChange={e => setAy((e.target as HTMLSelectElement).value)} style={{ padding: '0.4rem 0.625rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.8rem' }}>
          <option value="">Academic Year</option>
          {years.map(y => <option key={y.id} value={y.id}>{y.name}{y.is_current ? ' ★' : ''}</option>)}
        </select>
        <select value={cls} onChange={e => selectClass((e.target as HTMLSelectElement).value)} style={{ padding: '0.4rem 0.625rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.8rem' }}>
          <option value="">Class</option>
          {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={sec} onChange={e => selectSection((e.target as HTMLSelectElement).value)} style={{ padding: '0.4rem 0.625rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.8rem' }} disabled={!cls}>
          <option value="">{getSectionLabel()}</option>
          {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {err && <p style={{ color: '#ef4444', fontSize: '0.875rem' }}>{err}</p>}
      {loading && <p style={{ color: '#6b7280', fontSize: '0.875rem' }}>Loading…</p>}

      {!sec && !loading && (
        <p style={{ color: '#9ca3af', fontSize: '0.875rem', textAlign: 'center', padding: '2rem 0' }}>
          Select a class and section to view the timetable.
        </p>
      )}

      {timetable && !loading && (
        <>
          <div style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.5rem' }}>
            {timetable.class_name} — Section {timetable.section_name} · {timetable.slots.length} slot{timetable.slots.length !== 1 ? 's' : ''}
            <span style={{ marginLeft: '0.5rem', color: '#9ca3af' }}>· click any cell to add or edit</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.8rem' }}>
              <thead>
                <tr>
                  <th style={{ border: '1px solid #e5e7eb', padding: '0.4rem 0.625rem', background: '#f9fafb', color: '#6b7280', fontWeight: 600, textAlign: 'left', width: 70 }}>Period</th>
                  {DAY_NUMS.map((d, i) => (
                    <th key={d} style={{ border: '1px solid #e5e7eb', padding: '0.4rem 0.625rem', background: '#f9fafb', color: '#374151', fontWeight: 600, textAlign: 'center', minWidth: 110 }}>
                      {DAYS[i]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {periods.map(p => (
                  <tr key={p}>
                    <td style={{ border: '1px solid #e5e7eb', padding: '0.4rem 0.625rem', background: '#f9fafb', fontWeight: 600, color: '#374151', textAlign: 'center' }}>{p}</td>
                    {DAY_NUMS.map(d => {
                      const slot = slotMap.get(`${d}-${p}`)
                      return (
                        <SlotCell key={d} slot={slot}
                          onClick={() => setModal({ day: d, period: p, existing: slot })} />
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {modal && (
        <SlotModal
          state={modal}
          ay={ay} cls={cls} sec={sec}
          staff={staff}
          onSave={handleSave}
          onDelete={modalSlot ? () => handleDelete(modalSlot) : undefined}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}
