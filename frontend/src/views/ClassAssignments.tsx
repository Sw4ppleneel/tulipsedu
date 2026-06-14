import { useEffect, useState } from 'preact/hooks'
import { assignClass, listAllAssignments, listStaff, removeAssignment } from '../api/staff'
import { listAcademicYears, listClasses } from '../api/students'
import type { Assignment } from '../types/staff'
import type { AcademicYear, Class, Section } from '../types/student'
import type { Staff } from '../types/staff'

const INP: preact.JSX.CSSProperties = {
  padding: '0.375rem 0.625rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.8rem',
}
const BTN = (primary: boolean): preact.JSX.CSSProperties => ({
  padding: '0.375rem 0.875rem', border: 'none', borderRadius: 4, cursor: 'pointer',
  fontSize: '0.8rem', fontWeight: 600,
  background: primary ? '#14463A' : '#f3f4f6', color: primary ? '#fff' : '#374151',
})

export function ClassAssignmentsView() {
  const [years, setYears] = useState<AcademicYear[]>([])
  const [yearId, setYearId] = useState('')
  const [classes, setClasses] = useState<Class[]>([])
  const [staff, setStaff] = useState<Staff[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  // New assignment form state
  const [formStaff, setFormStaff] = useState('')
  const [formClass, setFormClass] = useState('')
  const [formSection, setFormSection] = useState('')
  const [formSubject, setFormSubject] = useState('')
  const [formCT, setFormCT] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([listAcademicYears(), listClasses(), listStaff({ limit: 200 })]).then(
      ([ys, cs, sr]) => {
        setYears(ys)
        setClasses(cs)
        setStaff(sr.items)
        const cur = ys.find(y => y.is_current)?.id ?? ys[0]?.id ?? ''
        setYearId(cur)
      }
    )
  }, [])

  useEffect(() => {
    if (!yearId) return
    setLoading(true)
    setErr('')
    listAllAssignments({ academic_year_id: yearId })
      .then(setAssignments)
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false))
  }, [yearId])

  const sections: Section[] = classes.find(c => c.id === formClass)?.sections ?? []

  async function addAssignment(e: Event) {
    e.preventDefault()
    if (!formStaff || !formClass || !formSection || !yearId) return
    setSaving(true); setErr('')
    try {
      const created = await assignClass(formStaff, {
        academic_year_id: yearId,
        class_id: formClass,
        section_id: formSection,
        subject: formSubject.trim() || undefined,
        is_class_teacher: formCT,
      })
      const staffMember = staff.find(s => s.id === formStaff)
      const cls = classes.find(c => c.id === formClass)
      const sec = cls?.sections?.find(s => s.id === formSection)
      setAssignments(prev => [...prev, {
        ...created,
        staff_name: staffMember ? `${staffMember.first_name} ${staffMember.last_name}` : '',
        designation: staffMember?.designation,
        class_name: cls?.name ?? null,
        section_name: sec?.name ?? null,
        academic_year_name: years.find(y => y.id === yearId)?.name ?? null,
      }])
      setFormSubject(''); setFormCT(false)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed') }
    finally { setSaving(false) }
  }

  async function remove(a: Assignment) {
    if (!confirm(`Remove ${a.staff_name ?? 'this assignment'}?`)) return
    try {
      await removeAssignment(a.staff_id, a.id)
      setAssignments(prev => prev.filter(x => x.id !== a.id))
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to remove') }
  }

  // Group by class+section for the display table
  const grouped = assignments.reduce<Record<string, Assignment[]>>((acc, a) => {
    const key = `${a.class_name ?? ''} ${a.section_name ?? ''}`
    ;(acc[key] = acc[key] ?? []).push(a)
    return acc
  }, {})

  return (
    <div style={{ padding: '1.5rem', maxWidth: 900 }}>
      <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.1rem', fontWeight: 700 }}>Class & Subject Assignments</h2>
      <p style={{ margin: '0 0 1.25rem', fontSize: '0.8rem', color: '#6b7280' }}>
        Assign teachers as class teachers or subject teachers for each section. Class teachers get student-roster access; subject teachers get marks-entry access for their subject.
      </p>

      {/* Year selector */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', alignItems: 'center' }}>
        <label style={{ fontSize: '0.8rem', fontWeight: 600 }}>Academic Year</label>
        <select value={yearId} onChange={e => setYearId((e.target as HTMLSelectElement).value)} style={INP}>
          {years.map(y => <option key={y.id} value={y.id}>{y.name}{y.is_current ? ' ★' : ''}</option>)}
        </select>
      </div>

      {err && <p style={{ color: '#dc2626', fontSize: '0.8rem', marginBottom: '0.75rem' }}>{err}</p>}

      {/* Add assignment form */}
      <form onSubmit={addAssignment} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '1rem', marginBottom: '1.5rem' }}>
        <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', fontWeight: 600 }}>Add Assignment</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.625rem', marginBottom: '0.75rem' }}>
          <div>
            <label style={{ fontSize: '0.72rem', fontWeight: 600, display: 'block', marginBottom: 2 }}>Staff Member</label>
            <select value={formStaff} onChange={e => setFormStaff((e.target as HTMLSelectElement).value)} style={{ ...INP, width: '100%' }} required>
              <option value="">— select —</option>
              {staff.map(s => <option key={s.id} value={s.id}>{s.first_name} {s.last_name} ({s.designation ?? 'Staff'})</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '0.72rem', fontWeight: 600, display: 'block', marginBottom: 2 }}>Class</label>
            <select value={formClass} onChange={e => { setFormClass((e.target as HTMLSelectElement).value); setFormSection('') }} style={{ ...INP, width: '100%' }} required>
              <option value="">— select —</option>
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '0.72rem', fontWeight: 600, display: 'block', marginBottom: 2 }}>Section</label>
            <select value={formSection} onChange={e => setFormSection((e.target as HTMLSelectElement).value)} style={{ ...INP, width: '100%' }} disabled={!formClass} required>
              <option value="">— select —</option>
              {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.625rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label style={{ fontSize: '0.72rem', fontWeight: 600, display: 'block', marginBottom: 2 }}>Subject <span style={{ color: '#9ca3af', fontWeight: 400 }}>(leave blank for class-teacher only)</span></label>
            <input value={formSubject} onInput={e => setFormSubject((e.target as HTMLInputElement).value)}
              placeholder="e.g. Mathematics" style={{ ...INP, width: '100%' }} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8rem', cursor: 'pointer', paddingBottom: 2 }}>
            <input type="checkbox" checked={formCT} onChange={e => setFormCT((e.target as HTMLInputElement).checked)} />
            Class Teacher
          </label>
          <button type="submit" disabled={saving} style={BTN(true)}>
            {saving ? 'Saving…' : '+ Add'}
          </button>
        </div>
      </form>

      {/* Assignments table grouped by class-section */}
      {loading && <p style={{ color: '#6b7280', fontSize: '0.875rem' }}>Loading…</p>}
      {!loading && Object.keys(grouped).length === 0 && (
        <p style={{ color: '#9ca3af', fontSize: '0.875rem' }}>No assignments yet for this year. Add one above.</p>
      )}
      {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([group, rows]) => (
        <div key={group} style={{ marginBottom: '1.25rem' }}>
          <h4 style={{ margin: '0 0 0.375rem', fontSize: '0.875rem', fontWeight: 700, color: '#14463A' }}>{group}</h4>
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden' }}>
            <div style={{ display: 'flex', padding: '0 1rem', height: 32, background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontSize: '0.7rem', fontWeight: 600, color: '#6b7280', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ flex: 1 }}>TEACHER</span>
              <span style={{ width: 80 }}>ROLE</span>
              <span style={{ width: 140 }}>SUBJECT</span>
              <span style={{ width: 80 }}>CLASS TCH</span>
              <span style={{ width: 50 }}></span>
            </div>
            {rows.map(a => (
              <div key={a.id} style={{ display: 'flex', padding: '0.45rem 1rem', borderBottom: '1px solid #f3f4f6', gap: '0.75rem', fontSize: '0.8rem', alignItems: 'center' }}>
                <span style={{ flex: 1, fontWeight: 500 }}>{a.staff_name ?? a.staff_id}</span>
                <span style={{ width: 80, color: '#6b7280', fontSize: '0.75rem' }}>{a.designation ?? '—'}</span>
                <span style={{ width: 140, color: a.subject ? '#111827' : '#9ca3af' }}>{a.subject ?? '—'}</span>
                <span style={{ width: 80 }}>
                  {a.is_class_teacher
                    ? <span style={{ padding: '1px 6px', background: '#d1fae5', color: '#0D332A', borderRadius: 9999, fontSize: '0.7rem', fontWeight: 700 }}>Yes</span>
                    : <span style={{ color: '#9ca3af' }}>—</span>
                  }
                </span>
                <button onClick={() => remove(a)} style={{ width: 50, background: 'none', border: '1px solid #fca5a5', color: '#dc2626', borderRadius: 4, padding: '0.2rem 0.4rem', cursor: 'pointer', fontSize: '0.72rem' }}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
