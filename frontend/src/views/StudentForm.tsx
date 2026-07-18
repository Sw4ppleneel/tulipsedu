import { useEffect, useRef, useState } from 'preact/hooks'
import { createStudent, resetPortalPassword, updateStudent } from '../api/students'
import { getStudentDiscounts, listFeeHeads, setStudentDiscounts } from '../api/finance'
import type { FeeHead } from '../types/finance'
import type { AcademicYear, Class, Section, Student, StudentCreate } from '../types/student'
import { getSectionLabel } from '../api/auth_state'
import { isValidIndianMobile, INVALID_PHONE_MSG } from '../utils/phone'

interface Props {
  academicYears: AcademicYear[]
  classes: Class[]
  student?: Student
  onSaved: () => void
  onCancel: () => void
}

const ROW: preact.JSX.CSSProperties = { marginBottom: '0.875rem' }
const SUB_CARD: preact.JSX.CSSProperties = {
  marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid #e5e7eb',
}
const LABEL: preact.JSX.CSSProperties = { display: 'block', fontSize: '0.8rem', color: '#555', marginBottom: '0.25rem' }
const INPUT: preact.JSX.CSSProperties = { width: '100%', padding: '0.5rem', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.875rem', boxSizing: 'border-box' }
const INPUT_DISABLED: preact.JSX.CSSProperties = { ...INPUT, background: '#f3f4f6', color: '#6b7280', cursor: 'not-allowed' }

// Sibling/concession discount editor: one percentage, applied to the selected
// fee heads. Saving replaces the student's whole discount set and recomputes
// their unpaid ledger rows server-side (paid/waived rows are never touched).
function DiscountSection({ studentId }: { studentId: string }) {
  const [heads, setHeads] = useState<FeeHead[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pct, setPct] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    Promise.all([listFeeHeads(), getStudentDiscounts(studentId)])
      .then(([hs, ds]) => {
        setHeads(hs.filter((h) => h.is_active))
        setSelected(new Set(ds.map((d) => d.fee_head_id)))
        if (ds.length > 0) setPct(String(Number(ds[0].percentage)))
        setLoaded(true)
      })
      .catch((e) => { setErr(e instanceof Error ? e.message : 'Failed to load discounts'); setLoaded(true) })
  }, [studentId])

  async function save() {
    setErr(''); setMsg('')
    const p = Number(pct)
    if (selected.size > 0 && (!Number.isFinite(p) || p <= 0 || p > 100)) {
      setErr('Enter a discount percentage between 1 and 100'); return
    }
    setSaving(true)
    try {
      const res = await setStudentDiscounts({
        student_id: studentId,
        items: Array.from(selected).map((fee_head_id) => ({ fee_head_id, percentage: p })),
      })
      setMsg(selected.size === 0
        ? `Discounts cleared — ${res.ledger_rows_updated} pending fee entries restored to full amount`
        : `Discount saved — ${res.ledger_rows_updated} pending fee entries updated`)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to save discount') }
    finally { setSaving(false) }
  }

  return (
    <div style={SUB_CARD}>
      <h4 style={{ margin: '0 0 0.35rem', fontSize: '0.9rem', fontWeight: 600 }}>Sibling / Concession Discount</h4>
      <p style={{ fontSize: '0.75rem', color: '#6b7280', margin: '0 0 0.75rem' }}>
        Applies the percentage to the selected fee heads — unpaid dues are recalculated
        immediately and future fee generation uses the discounted amount. Already-paid
        months are never changed.
      </p>
      {!loaded && <p style={{ fontSize: '0.8rem', color: '#9ca3af' }}>Loading…</p>}
      {loaded && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem' }}>
            <label style={{ fontSize: '0.8rem', color: '#555' }}>Discount</label>
            <input type="number" min={1} max={100} value={pct}
              onInput={(e) => setPct((e.target as HTMLInputElement).value)}
              style={{ width: 70, padding: '0.4rem 0.5rem', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.875rem' }} />
            <span style={{ fontSize: '0.8rem', color: '#555' }}>% on:</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem 1rem', marginBottom: '0.75rem' }}>
            {heads.map((h) => (
              <label key={h.id} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.82rem', color: '#374151', cursor: 'pointer' }}>
                <input type="checkbox" checked={selected.has(h.id)} onChange={(e) => {
                  const on = (e.target as HTMLInputElement).checked
                  setSelected((prev) => { const n = new Set(prev); on ? n.add(h.id) : n.delete(h.id); return n })
                }} />
                {h.name}
              </label>
            ))}
            {heads.length === 0 && <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>No fee heads set up yet.</span>}
          </div>
          <button type="button" onClick={save} disabled={saving}
            style={{ padding: '0.5rem 1rem', background: '#14463A', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 }}>
            {saving ? 'Saving…' : selected.size === 0 ? 'Clear Discounts' : 'Save Discount'}
          </button>
          {err && <p style={{ color: '#c00', fontSize: '0.78rem', margin: '0.5rem 0 0' }}>{err}</p>}
          {msg && !err && <p style={{ color: '#1F8A5D', fontSize: '0.78rem', margin: '0.5rem 0 0' }}>✓ {msg}</p>}
        </>
      )}
    </div>
  )
}

// Principal-side reset of the parent-portal password (teachers have the same
// control for their own class in the teacher portal's My Students section).
function PortalPasswordSection({ studentId }: { studentId: string }) {
  const [pw, setPw] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  async function reset() {
    setErr(''); setMsg('')
    if (pw.trim().length < 4) { setErr('Password must be at least 4 characters'); return }
    setSaving(true)
    try {
      await resetPortalPassword(studentId, pw.trim())
      setMsg('Portal password reset'); setPw('')
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to reset password') }
    finally { setSaving(false) }
  }

  return (
    <div style={SUB_CARD}>
      <h4 style={{ margin: '0 0 0.35rem', fontSize: '0.9rem', fontWeight: 600 }}>Parent Portal Password</h4>
      <p style={{ fontSize: '0.75rem', color: '#6b7280', margin: '0 0 0.6rem' }}>
        Default is the last 4 digits of the parent's phone. Set a new one here if the parent is locked out.
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <input value={pw} onInput={(e) => setPw((e.target as HTMLInputElement).value)}
          placeholder="New password (min. 4)"
          style={{ width: 200, padding: '0.4rem 0.5rem', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.875rem' }} />
        <button type="button" onClick={reset} disabled={saving}
          style={{ padding: '0.5rem 1rem', background: '#B4532A', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 }}>
          {saving ? 'Resetting…' : 'Reset Password'}
        </button>
      </div>
      {err && <p style={{ color: '#c00', fontSize: '0.78rem', margin: '0.5rem 0 0' }}>{err}</p>}
      {msg && !err && <p style={{ color: '#1F8A5D', fontSize: '0.78rem', margin: '0.5rem 0 0' }}>✓ {msg}</p>}
    </div>
  )
}

export function StudentForm({ academicYears, classes, student, onSaved, onCancel }: Props) {
  const isEdit = !!student
  const [form, setForm] = useState<StudentCreate>(student ? {
    academic_year_id: student.academic_year_id,
    class_id: student.class_id,
    section_id: student.section_id,
    admission_no: student.admission_no,
    roll_number: student.roll_number,
    first_name: student.first_name,
    last_name: student.last_name,
    date_of_birth: student.date_of_birth,
    gender: student.gender,
    parent_phone: student.parent_phone,
    is_hosteler: student.is_hosteler,
    is_transport: student.is_transport,
  } : {
    academic_year_id: academicYears.find((y) => y.is_current)?.id ?? academicYears[0]?.id ?? '',
    class_id: '',
    section_id: '',
    admission_no: '',
    roll_number: '',
    first_name: '',
    last_name: '',
    date_of_birth: '',
    gender: 'Male',
    parent_phone: '',
    is_hosteler: false,
    is_transport: false,
  })
  const [sections, setSections] = useState<Section[]>(
    () => classes.find((c) => c.id === form.class_id)?.sections ?? []
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // Optional at creation time — if left blank, the parent portal falls back to
  // its default (last 4 digits of parent_phone) the same as every other student.
  const [initialPassword, setInitialPassword] = useState('')
  // Skip clearing section_id on the effect's first run in edit mode, so the
  // student's existing section survives the initial class_id -> sections sync.
  const skipNextClear = useRef(isEdit)

  useEffect(() => {
    const cls = classes.find((c) => c.id === form.class_id)
    setSections(cls?.sections ?? [])
    if (skipNextClear.current) {
      skipNextClear.current = false
      return
    }
    set('section_id', '')
  }, [form.class_id])

  function set(field: keyof StudentCreate, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: Event) {
    e.preventDefault()
    setError('')
    if (!isValidIndianMobile(form.parent_phone)) { setError(INVALID_PHONE_MSG); return }
    if (!isEdit && initialPassword && initialPassword.trim().length < 4) {
      setError('Portal password must be at least 4 characters'); return
    }
    setLoading(true)
    try {
      if (isEdit && student) {
        const { admission_no: _admission_no, academic_year_id: _academic_year_id, ...editable } = form
        await updateStudent(student.id, editable)
      } else {
        const created = await createStudent(form)
        if (initialPassword.trim()) {
          await resetPortalPassword(created.id, initialPassword.trim())
        }
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${isEdit ? 'update' : 'create'} student`)
    } finally {
      setLoading(false)
    }
  }

  const grid2: preact.JSX.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '1.5rem', marginBottom: '1rem' }}>
      <h3 style={{ margin: '0 0 1.25rem', fontSize: '1rem', fontWeight: 600 }}>{isEdit ? 'Edit Student' : 'Add Student'}</h3>
      {error && <p style={{ color: '#c00', fontSize: '0.875rem', marginBottom: '1rem' }}>{error}</p>}
      <form onSubmit={handleSubmit}>

        <div style={ROW}>
          <label style={LABEL}>Academic Year{isEdit ? ' (not editable here)' : ''}</label>
          <select
            value={form.academic_year_id}
            onChange={(e) => set('academic_year_id', (e.target as HTMLSelectElement).value)}
            style={isEdit ? INPUT_DISABLED : INPUT}
            required
            disabled={isEdit}
          >
            <option value="">Select year</option>
            {academicYears.map((y) => (
              <option key={y.id} value={y.id}>{y.name}{y.is_current ? ' (current)' : ''}</option>
            ))}
          </select>
        </div>

        <div style={{ ...grid2, ...ROW }}>
          <div>
            <label style={LABEL}>Class</label>
            <select
              value={form.class_id}
              onChange={(e) => set('class_id', (e.target as HTMLSelectElement).value)}
              style={INPUT}
              required
            >
              <option value="">Select class</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={LABEL}>{getSectionLabel()}</label>
            <select
              value={form.section_id}
              onChange={(e) => set('section_id', (e.target as HTMLSelectElement).value)}
              style={INPUT}
              required
              disabled={!form.class_id}
            >
              <option value="">Select section</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ ...grid2, ...ROW }}>
          <div>
            <label style={LABEL}>Admission No.{isEdit ? ' (not editable)' : ''}</label>
            <input value={form.admission_no} onInput={(e) => set('admission_no', (e.target as HTMLInputElement).value)} style={isEdit ? INPUT_DISABLED : INPUT} placeholder="2024001" required disabled={isEdit} />
          </div>
          <div>
            <label style={LABEL}>Roll Number</label>
            <input value={form.roll_number} onInput={(e) => set('roll_number', (e.target as HTMLInputElement).value)} style={INPUT} placeholder="1" required />
          </div>
        </div>

        <div style={{ ...grid2, ...ROW }}>
          <div>
            <label style={LABEL}>First Name</label>
            <input value={form.first_name} onInput={(e) => set('first_name', (e.target as HTMLInputElement).value)} style={INPUT} required />
          </div>
          <div>
            <label style={LABEL}>Last Name</label>
            <input value={form.last_name} onInput={(e) => set('last_name', (e.target as HTMLInputElement).value)} style={INPUT} required />
          </div>
        </div>

        <div style={{ ...grid2, ...ROW }}>
          <div>
            <label style={LABEL}>Date of Birth</label>
            <input type="date" value={form.date_of_birth} onInput={(e) => set('date_of_birth', (e.target as HTMLInputElement).value)} style={INPUT} required />
          </div>
          <div>
            <label style={LABEL}>Gender</label>
            <select value={form.gender} onChange={(e) => set('gender', (e.target as HTMLSelectElement).value)} style={INPUT} required>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Other">Other</option>
            </select>
          </div>
        </div>

        <div style={ROW}>
          <label style={LABEL}>Parent Phone (10 digits)</label>
          <input type="tel" value={form.parent_phone} onInput={(e) => set('parent_phone', (e.target as HTMLInputElement).value)} style={INPUT} placeholder="9876543210" maxLength={10} required />
        </div>

        {!isEdit && (
          <div style={ROW}>
            <label style={LABEL}>Parent Portal Password (optional)</label>
            <input
              value={initialPassword}
              onInput={(e) => setInitialPassword((e.target as HTMLInputElement).value)}
              style={INPUT}
              placeholder="Leave blank to default to last 4 digits of parent phone"
            />
          </div>
        )}

        <div style={{ ...ROW, display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', color: '#444', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.is_hosteler} onChange={(e) => set('is_hosteler', (e.target as HTMLInputElement).checked)} />
            Day boarder / Hosteler
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', color: '#444', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.is_transport ?? false} onChange={(e) => set('is_transport', (e.target as HTMLInputElement).checked)} />
            Uses school transport
          </label>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
          <button
            type="submit"
            disabled={loading}
            style={{ padding: '0.625rem 1.25rem', background: '#14463A', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem' }}
          >
            {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Save Student'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            style={{ padding: '0.625rem 1.25rem', background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem' }}
          >
            Cancel
          </button>
        </div>
      </form>

      {isEdit && student && (
        <>
          <DiscountSection studentId={student.id} />
          <PortalPasswordSection studentId={student.id} />
        </>
      )}
    </div>
  )
}
