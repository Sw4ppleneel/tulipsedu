import { useEffect, useState } from 'preact/hooks'
import { createStudent } from '../api/students'
import type { AcademicYear, Class, Section, StudentCreate } from '../types/student'
import { getSectionLabel } from '../api/auth_state'
import { isValidIndianMobile, INVALID_PHONE_MSG } from '../utils/phone'

interface Props {
  academicYears: AcademicYear[]
  classes: Class[]
  onCreated: () => void
  onCancel: () => void
}

const ROW: preact.JSX.CSSProperties = { marginBottom: '0.875rem' }
const LABEL: preact.JSX.CSSProperties = { display: 'block', fontSize: '0.8rem', color: '#555', marginBottom: '0.25rem' }
const INPUT: preact.JSX.CSSProperties = { width: '100%', padding: '0.5rem', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.875rem', boxSizing: 'border-box' }

export function StudentForm({ academicYears, classes, onCreated, onCancel }: Props) {
  const [form, setForm] = useState<StudentCreate>({
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
  const [sections, setSections] = useState<Section[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const cls = classes.find((c) => c.id === form.class_id)
    setSections(cls?.sections ?? [])
    set('section_id', '')
  }, [form.class_id])

  function set(field: keyof StudentCreate, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: Event) {
    e.preventDefault()
    setError('')
    if (!isValidIndianMobile(form.parent_phone)) { setError(INVALID_PHONE_MSG); return }
    setLoading(true)
    try {
      await createStudent(form)
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create student')
    } finally {
      setLoading(false)
    }
  }

  const grid2: preact.JSX.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '1.5rem', marginBottom: '1rem' }}>
      <h3 style={{ margin: '0 0 1.25rem', fontSize: '1rem', fontWeight: 600 }}>Add Student</h3>
      {error && <p style={{ color: '#c00', fontSize: '0.875rem', marginBottom: '1rem' }}>{error}</p>}
      <form onSubmit={handleSubmit}>

        <div style={ROW}>
          <label style={LABEL}>Academic Year</label>
          <select
            value={form.academic_year_id}
            onChange={(e) => set('academic_year_id', (e.target as HTMLSelectElement).value)}
            style={INPUT}
            required
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
            <label style={LABEL}>Admission No.</label>
            <input value={form.admission_no} onInput={(e) => set('admission_no', (e.target as HTMLInputElement).value)} style={INPUT} placeholder="2024001" required />
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
            {loading ? 'Saving…' : 'Save Student'}
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
    </div>
  )
}
