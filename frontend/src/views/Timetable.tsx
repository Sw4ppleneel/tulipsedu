import { useEffect, useState } from 'preact/hooks'
import { getClassTimetable, upsertSlot, deleteSlot } from '../api/timetable'
import { listAcademicYears, listClasses } from '../api/students'
import type { WeeklyTimetable, TimetableSlot, SlotUpsert } from '../api/timetable'
import type { AcademicYear, Class, Section } from '../types/student'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_NUMS = [1, 2, 3, 4, 5, 6]

const CELL: preact.JSX.CSSProperties = {
  border: '1px solid #e5e7eb', padding: '0.4rem', minHeight: 64,
  fontSize: '0.75rem', verticalAlign: 'top', background: '#fff',
}

function SlotCell({ slot, onDelete }: { slot: TimetableSlot | undefined; onDelete?: () => void }) {
  if (!slot) return <td style={{ ...CELL, background: '#fafafa' }} />
  return (
    <td style={{ ...CELL, background: '#EDF3EE', position: 'relative' }}>
      <div style={{ fontWeight: 600, color: '#0D332A', marginBottom: 2 }}>{slot.subject}</div>
      {slot.staff_name && <div style={{ color: '#6b7280' }}>{slot.staff_name}</div>}
      {slot.room && <div style={{ color: '#9ca3af' }}>Rm {slot.room}</div>}
      <div style={{ color: '#9ca3af' }}>{slot.start_time.slice(0, 5)}–{slot.end_time.slice(0, 5)}</div>
      <button
        onClick={onDelete}
        style={{ position: 'absolute', top: 2, right: 3, background: 'none', border: 'none', cursor: 'pointer', color: '#d1d5db', fontSize: '0.85rem', lineHeight: 1 }}
        title="Remove slot"
      >×</button>
    </td>
  )
}

function SlotForm({
  ay, cls, sec, onSave, onCancel,
}: {
  ay: string; cls: string; sec: string
  onSave: (d: SlotUpsert) => Promise<void>
  onCancel: () => void
}) {
  const [day, setDay] = useState(1)
  const [period, setPeriod] = useState(1)
  const [start, setStart] = useState('08:00')
  const [end, setEnd] = useState('08:45')
  const [subject, setSubject] = useState('')
  const [room, setRoom] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e: Event) {
    e.preventDefault()
    if (!subject) { setErr('Subject is required'); return }
    setSaving(true); setErr('')
    try {
      await onSave({ academic_year_id: ay, class_id: cls, section_id: sec, day_of_week: day, period_number: period, start_time: start, end_time: end, subject, room: room || undefined })
    } catch (ex) { setErr(ex instanceof Error ? ex.message : 'Error') }
    finally { setSaving(false) }
  }

  const INP: preact.JSX.CSSProperties = { padding: '0.4rem 0.5rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.8rem', width: '100%', boxSizing: 'border-box' }
  const LBL: preact.JSX.CSSProperties = { fontSize: '0.7rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 2 }

  return (
    <form onSubmit={submit} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.625rem', marginBottom: '0.625rem' }}>
        <div>
          <label style={LBL}>Day</label>
          <select value={day} onChange={e => setDay(+(e.target as HTMLSelectElement).value)} style={INP}>
            {DAYS.map((d, i) => <option key={i} value={i + 1}>{d}</option>)}
          </select>
        </div>
        <div>
          <label style={LBL}>Period #</label>
          <input type="number" min={1} max={12} value={period} onInput={e => setPeriod(+(e.target as HTMLInputElement).value)} style={INP} />
        </div>
        <div>
          <label style={LBL}>Subject *</label>
          <input value={subject} onInput={e => setSubject((e.target as HTMLInputElement).value)} style={INP} placeholder="e.g. Mathematics" />
        </div>
        <div>
          <label style={LBL}>Start</label>
          <input type="time" value={start} onInput={e => setStart((e.target as HTMLInputElement).value)} style={INP} />
        </div>
        <div>
          <label style={LBL}>End</label>
          <input type="time" value={end} onInput={e => setEnd((e.target as HTMLInputElement).value)} style={INP} />
        </div>
        <div>
          <label style={LBL}>Room</label>
          <input value={room} onInput={e => setRoom((e.target as HTMLInputElement).value)} style={INP} placeholder="optional" />
        </div>
      </div>
      {err && <p style={{ color: '#ef4444', fontSize: '0.75rem', margin: '0 0 0.5rem' }}>{err}</p>}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button type="submit" disabled={saving} style={{ padding: '0.4rem 1rem', background: '#14463A', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' }}>
          {saving ? 'Saving…' : 'Add Slot'}
        </button>
        <button type="button" onClick={onCancel} style={{ padding: '0.4rem 0.875rem', background: 'none', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem', color: '#374151' }}>
          Cancel
        </button>
      </div>
    </form>
  )
}

export function TimetableView() {
  const [years, setYears] = useState<AcademicYear[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [ay, setAy] = useState('')
  const [cls, setCls] = useState('')
  const [sec, setSec] = useState('')
  const [timetable, setTimetable] = useState<WeeklyTimetable | null>(null)
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    Promise.all([listAcademicYears(), listClasses()]).then(([ay, cls]) => {
      setYears(ay)
      setClasses(cls)
      const cur = ay.find(y => y.is_current)
      if (cur) setAy(cur.id)
    })
  }, [])

  const sections: Section[] = classes.find(c => c.id === cls)?.sections ?? []

  async function loadTimetable(ayId: string, clsId: string, secId: string) {
    if (!ayId || !clsId || !secId) return
    setLoading(true); setErr('')
    try {
      const data = await getClassTimetable({ academic_year_id: ayId, class_id: clsId, section_id: secId })
      setTimetable(data)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to load') }
    finally { setLoading(false) }
  }

  function select(ayId: string, clsId: string, secId: string) {
    setAy(ayId); setCls(clsId); setSec(secId)
    if (ayId && clsId && secId) loadTimetable(ayId, clsId, secId)
  }

  async function handleAddSlot(data: SlotUpsert) {
    await upsertSlot(data)
    setShowForm(false)
    loadTimetable(ay, cls, sec)
  }

  async function handleDeleteSlot(slot: TimetableSlot) {
    if (!confirm(`Remove ${slot.subject} on ${slot.day_name} period ${slot.period_number}?`)) return
    await deleteSlot({ academic_year_id: ay, class_id: cls, section_id: sec, day_of_week: slot.day_of_week, period_number: slot.period_number })
    loadTimetable(ay, cls, sec)
  }

  // Build slot map: day → period → slot
  const slotMap = new Map<string, TimetableSlot>()
  timetable?.slots.forEach(s => slotMap.set(`${s.day_of_week}-${s.period_number}`, s))

  const maxPeriod = timetable && timetable.slots.length > 0
    ? Math.max(...timetable.slots.map(s => s.period_number))
    : 6

  const periods = Array.from({ length: maxPeriod }, (_, i) => i + 1)

  return (
    <div style={{ maxWidth: 1000, margin: '1.5rem auto', padding: '0 1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#111827' }}>Timetable</h2>
        {timetable && (
          <button onClick={() => setShowForm(s => !s)} style={{ padding: '0.4rem 1rem', background: '#14463A', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem' }}>
            {showForm ? 'Cancel' : '+ Add Slot'}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: '0.625rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <select value={ay} onChange={e => select((e.target as HTMLSelectElement).value, cls, sec)} style={{ padding: '0.4rem 0.625rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.8rem' }}>
          <option value="">Academic Year</option>
          {years.map(y => <option key={y.id} value={y.id}>{y.name}</option>)}
        </select>
        <select value={cls} onChange={e => { const v = (e.target as HTMLSelectElement).value; setSec(''); setTimetable(null); select(ay, v, '') }} style={{ padding: '0.4rem 0.625rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.8rem' }}>
          <option value="">Class</option>
          {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={sec} onChange={e => select(ay, cls, (e.target as HTMLSelectElement).value)} style={{ padding: '0.4rem 0.625rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.8rem' }} disabled={!cls}>
          <option value="">Section</option>
          {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {showForm && cls && sec && (
        <SlotForm ay={ay} cls={cls} sec={sec} onSave={handleAddSlot} onCancel={() => setShowForm(false)} />
      )}

      {err && <p style={{ color: '#ef4444', fontSize: '0.875rem' }}>{err}</p>}
      {loading && <p style={{ color: '#6b7280', fontSize: '0.875rem' }}>Loading…</p>}

      {!sec && !loading && (
        <p style={{ color: '#9ca3af', fontSize: '0.875rem', textAlign: 'center', padding: '2rem 0' }}>Select a class and section to view the timetable.</p>
      )}

      {timetable && !loading && (
        <>
          <div style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.5rem' }}>
            {timetable.class_name} — Section {timetable.section_name} · {timetable.slots.length} slot{timetable.slots.length !== 1 ? 's' : ''}
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
                      return <SlotCell key={d} slot={slot} onDelete={slot ? () => handleDeleteSlot(slot) : undefined} />
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
