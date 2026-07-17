import { useEffect, useState } from 'preact/hooks'
import { listStudents, resetPortalPassword, updateStudentContact } from '../api/students'
import { getAssignedClasses, type ScopedClass } from '../api/teacher'
import type { Student } from '../types/student'
import { Spinner, EmptyState } from '../ui'
import { isValidIndianMobile, INVALID_PHONE_MSG } from '../utils/phone'
import { getSectionLabel } from '../api/auth_state'

const PLACEHOLDER_PHONE = '0000000000'

const CARD: preact.JSX.CSSProperties = {
  background: '#fff', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,.07)', overflow: 'hidden',
}
const INP: preact.JSX.CSSProperties = {
  padding: '0.4rem 0.5rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.8rem',
  fontFamily: 'inherit', boxSizing: 'border-box',
}
const BTN: preact.JSX.CSSProperties = {
  padding: '0.35rem 0.7rem', border: 'none', borderRadius: 4, cursor: 'pointer',
  fontSize: '0.72rem', fontWeight: 700, fontFamily: 'inherit',
}

// One roster row: parent phone inline-editable; portal-password reset expands
// into a tiny inline form (no browser prompt()).
function StudentRow({ s, onSaved }: { s: Student; onSaved: () => void }) {
  const [phone, setPhone] = useState(s.parent_phone === PLACEHOLDER_PHONE ? '' : s.parent_phone)
  const [savingPhone, setSavingPhone] = useState(false)
  const [showReset, setShowReset] = useState(false)
  const [newPw, setNewPw] = useState('')
  const [savingPw, setSavingPw] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const phoneDirty = phone.trim() !== (s.parent_phone === PLACEHOLDER_PHONE ? '' : s.parent_phone)
  const missingPhone = s.parent_phone === PLACEHOLDER_PHONE || !s.parent_phone

  async function savePhone() {
    setErr(''); setMsg('')
    if (!isValidIndianMobile(phone.trim())) { setErr(INVALID_PHONE_MSG); return }
    setSavingPhone(true)
    try {
      await updateStudentContact(s.id, phone.trim())
      setMsg('Phone updated')
      onSaved()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed') }
    finally { setSavingPhone(false) }
  }

  async function resetPw() {
    setErr(''); setMsg('')
    if (newPw.trim().length < 4) { setErr('Password must be at least 4 characters'); return }
    setSavingPw(true)
    try {
      await resetPortalPassword(s.id, newPw.trim())
      setMsg('Portal password reset')
      setShowReset(false); setNewPw('')
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed') }
    finally { setSavingPw(false) }
  }

  return (
    <div style={{ padding: '.6rem 1rem', borderBottom: '1px solid #f3f4f6' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 160px', minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '.85rem', color: '#111827' }}>
            {s.first_name} {s.last_name}
          </div>
          <div style={{ fontSize: '.7rem', color: '#9ca3af' }}>
            Roll {s.roll_number} · {s.admission_no}
            {missingPhone && <span style={{ marginLeft: '.4rem', color: '#b91c1c', fontWeight: 700 }}>no phone</span>}
          </div>
        </div>
        <input
          value={phone}
          onInput={e => setPhone((e.target as HTMLInputElement).value)}
          placeholder="Parent mobile number"
          inputMode="numeric"
          style={{ ...INP, width: 150 }}
        />
        <button onClick={savePhone} disabled={!phoneDirty || savingPhone}
          style={{ ...BTN, background: phoneDirty ? '#14463A' : '#e5e7eb', color: phoneDirty ? '#fff' : '#9ca3af' }}>
          {savingPhone ? 'Saving…' : 'Save'}
        </button>
        <button onClick={() => { setShowReset(v => !v); setErr(''); setMsg('') }}
          style={{ ...BTN, background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db' }}>
          Reset password
        </button>
      </div>
      {showReset && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginTop: '.5rem' }}>
          <input
            value={newPw}
            onInput={e => setNewPw((e.target as HTMLInputElement).value)}
            placeholder="New portal password (min. 4)"
            style={{ ...INP, width: 210 }}
          />
          <button onClick={resetPw} disabled={savingPw}
            style={{ ...BTN, background: '#B4532A', color: '#fff' }}>
            {savingPw ? 'Resetting…' : 'Confirm reset'}
          </button>
        </div>
      )}
      {err && <div style={{ fontSize: '.72rem', color: '#b91c1c', marginTop: '.35rem' }}>{err}</div>}
      {msg && !err && <div style={{ fontSize: '.72rem', color: '#1F8A5D', marginTop: '.35rem' }}>✓ {msg}</div>}
    </div>
  )
}

export function TeacherStudentsView() {
  const [classes, setClasses] = useState<ScopedClass[] | null>(null)
  const [classId, setClassId] = useState('')
  const [sectionId, setSectionId] = useState('')
  const [students, setStudents] = useState<Student[] | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    getAssignedClasses()
      .then(cs => {
        setClasses(cs)
        if (cs.length > 0) {
          setClassId(cs[0].id)
          setSectionId(cs[0].sections[0]?.id ?? '')
        }
      })
      .catch(e => setErr(e instanceof Error ? e.message : 'Failed to load classes'))
  }, [])

  useEffect(() => {
    if (!classId || !sectionId) return
    setStudents(null)
    listStudents({ class_id: classId, section_id: sectionId, limit: 500 })
      .then(r => setStudents(r.items))
      .catch(e => setErr(e instanceof Error ? e.message : 'Failed to load students'))
  }, [classId, sectionId])

  if (err) return <div style={{ padding: '2rem', textAlign: 'center', color: '#ef4444' }}>{err}</div>
  if (!classes) return <Spinner label="Loading…" />
  if (classes.length === 0) {
    return <EmptyState title="No classes assigned to you yet" hint="Contact the office." />
  }

  const cls = classes.find(c => c.id === classId)

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '1rem' }}>
      <p class="text-sm text-muted" style={{ marginBottom: '.75rem' }}>
        Keep each student's parent mobile number up to date — the parent portal's
        default password is the <strong>last 4 digits</strong> of this number.
      </p>
      <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.75rem' }}>
        <select value={classId} onChange={e => {
          const id = (e.target as HTMLSelectElement).value
          setClassId(id)
          setSectionId(classes.find(c => c.id === id)?.sections[0]?.id ?? '')
        }} style={{ ...INP, flex: 1 }}>
          {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={sectionId} onChange={e => setSectionId((e.target as HTMLSelectElement).value)} style={{ ...INP, flex: 1 }}>
          {(cls?.sections ?? []).map(s => <option key={s.id} value={s.id}>{getSectionLabel()} {s.name}</option>)}
        </select>
      </div>
      <div style={CARD}>
        {!students && <Spinner label="Loading students…" />}
        {students && students.length === 0 && (
          <div style={{ padding: '1.5rem', textAlign: 'center', color: '#9ca3af', fontSize: '.85rem' }}>No students in this section.</div>
        )}
        {students?.map(s => <StudentRow key={s.id} s={s} onSaved={() => {}} />)}
      </div>
    </div>
  )
}
