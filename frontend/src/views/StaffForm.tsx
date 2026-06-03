import { useState } from 'preact/hooks'
import { createStaff } from '../api/staff'
import type { StaffCreate } from '../types/staff'

interface Props {
  onCreated: () => void
  onCancel: () => void
}

const ROW: preact.JSX.CSSProperties = { marginBottom: '0.875rem' }
const LBL: preact.JSX.CSSProperties = { display: 'block', fontSize: '0.8rem', color: '#555', marginBottom: '0.25rem' }
const INP: preact.JSX.CSSProperties = { width: '100%', padding: '0.5rem', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.875rem', boxSizing: 'border-box' }
const G2: preact.JSX.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }

const DESIGNATIONS = [
  'Teacher', 'Principal', 'Vice Principal', 'Head of Department',
  'Administrative Staff', 'Librarian', 'Physical Education Teacher',
  'Counselor', 'Support Staff', 'Other',
]

export function StaffForm({ onCreated, onCancel }: Props) {
  const [form, setForm] = useState<StaffCreate>({
    employee_no: '', first_name: '', last_name: '',
    phone_number: '', designation: 'Teacher',
    department: '', date_of_joining: '', date_of_birth: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function set(k: keyof StaffCreate, v: string) {
    setForm((p) => ({ ...p, [k]: v }))
  }

  async function handleSubmit(e: Event) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const payload: StaffCreate = { ...form }
      if (!payload.department) delete payload.department
      if (!payload.date_of_birth) delete payload.date_of_birth
      await createStaff(payload)
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create staff member')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '1.5rem', marginBottom: '1rem' }}>
      <h3 style={{ margin: '0 0 1.25rem', fontSize: '1rem', fontWeight: 600 }}>Add Staff Member</h3>
      {error && <p style={{ color: '#c00', fontSize: '0.875rem', marginBottom: '1rem' }}>{error}</p>}
      <form onSubmit={handleSubmit}>

        <div style={{ ...G2, ...ROW }}>
          <div>
            <label style={LBL}>Employee No.</label>
            <input value={form.employee_no} onInput={(e) => set('employee_no', (e.target as HTMLInputElement).value)} style={INP} placeholder="EMP001" required />
          </div>
          <div>
            <label style={LBL}>Phone Number</label>
            <input type="tel" value={form.phone_number} onInput={(e) => set('phone_number', (e.target as HTMLInputElement).value)} style={INP} required />
          </div>
        </div>

        <div style={{ ...G2, ...ROW }}>
          <div>
            <label style={LBL}>First Name</label>
            <input value={form.first_name} onInput={(e) => set('first_name', (e.target as HTMLInputElement).value)} style={INP} required />
          </div>
          <div>
            <label style={LBL}>Last Name</label>
            <input value={form.last_name} onInput={(e) => set('last_name', (e.target as HTMLInputElement).value)} style={INP} required />
          </div>
        </div>

        <div style={{ ...G2, ...ROW }}>
          <div>
            <label style={LBL}>Designation</label>
            <select value={form.designation} onChange={(e) => set('designation', (e.target as HTMLSelectElement).value)} style={INP} required>
              {DESIGNATIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label style={LBL}>Department (optional)</label>
            <input value={form.department} onInput={(e) => set('department', (e.target as HTMLInputElement).value)} style={INP} placeholder="Mathematics" />
          </div>
        </div>

        <div style={{ ...G2, ...ROW }}>
          <div>
            <label style={LBL}>Date of Joining</label>
            <input type="date" value={form.date_of_joining} onInput={(e) => set('date_of_joining', (e.target as HTMLInputElement).value)} style={INP} required />
          </div>
          <div>
            <label style={LBL}>Date of Birth (optional)</label>
            <input type="date" value={form.date_of_birth} onInput={(e) => set('date_of_birth', (e.target as HTMLInputElement).value)} style={INP} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
          <button type="submit" disabled={loading} style={{ padding: '0.625rem 1.25rem', background: '#1a56db', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem' }}>
            {loading ? 'Saving…' : 'Save Staff Member'}
          </button>
          <button type="button" onClick={onCancel} style={{ padding: '0.625rem 1.25rem', background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem' }}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
