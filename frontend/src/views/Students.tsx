import { useEffect, useState } from 'preact/hooks'
import { VirtualList } from '../components/VirtualList'
import { listAcademicYears, listClasses, listStudents } from '../api/students'
import { StudentForm } from './StudentForm'
import type { AcademicYear, Class, Student, StudentFilters } from '../types/student'

const ROW_HEIGHT = 56
const LIST_HEIGHT = 520

function StudentRow({ student }: { student: Student }) {
  return (
    <div style={{
      height: ROW_HEIGHT,
      display: 'flex',
      alignItems: 'center',
      padding: '0 1rem',
      borderBottom: '1px solid #f3f4f6',
      gap: '0.75rem',
      fontSize: '0.8rem',
      background: '#fff',
    }}>
      <span style={{ width: 52, fontWeight: 700, color: '#14463A', flexShrink: 0 }}>
        #{student.roll_number}
      </span>
      <span style={{ flex: 1, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {student.first_name} {student.last_name}
      </span>
      <span style={{ width: 110, color: '#6b7280', flexShrink: 0 }}>{student.admission_no}</span>
      <span style={{ width: 70, color: '#6b7280', flexShrink: 0 }}>{student.gender}</span>
      <span style={{ width: 110, color: '#6b7280', flexShrink: 0 }}>{student.parent_phone}</span>
      <span style={{ width: 80, textAlign: 'right', flexShrink: 0 }}>
        {student.is_hosteler && (
          <span style={{ padding: '2px 7px', background: '#e0f2fe', color: '#0369a1', borderRadius: 9999, fontSize: '0.7rem', fontWeight: 600 }}>
            Hosteler
          </span>
        )}
      </span>
    </div>
  )
}

function TableHeader() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', padding: '0 1rem',
      height: 36, background: '#f9fafb', borderBottom: '1px solid #e5e7eb',
      fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', gap: '0.75rem',
    }}>
      <span style={{ width: 52, flexShrink: 0 }}>ROLL</span>
      <span style={{ flex: 1 }}>NAME</span>
      <span style={{ width: 110, flexShrink: 0 }}>ADMISSION NO</span>
      <span style={{ width: 70, flexShrink: 0 }}>GENDER</span>
      <span style={{ width: 110, flexShrink: 0 }}>PARENT PHONE</span>
      <span style={{ width: 80, flexShrink: 0 }}></span>
    </div>
  )
}

export function StudentsView() {
  const [students, setStudents] = useState<Student[]>([])
  const [total, setTotal] = useState(0)
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [filters, setFilters] = useState<StudentFilters>({})
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([listAcademicYears(), listClasses()])
      .then(([years, cls]) => {
        setAcademicYears(years)
        setClasses(cls)
        const current = years.find((y) => y.is_current)
        if (current) setFilters((f) => ({ ...f, academic_year_id: current.id }))
      })
      .catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    setLoading(true)
    listStudents({ ...filters, limit: 500 })
      .then((res) => { setStudents(res.items); setTotal(res.total) })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [filters])

  const selectedClass = classes.find((c) => c.id === filters.class_id)
  const sections = selectedClass?.sections ?? []

  function setFilter(key: keyof StudentFilters, value: string) {
    setFilters((prev) => {
      const next = { ...prev, [key]: value || undefined }
      if (key === 'class_id') delete next.section_id
      return next
    })
  }

  const SELECT: preact.JSX.CSSProperties = {
    padding: '0.375rem 0.625rem', border: '1px solid #d1d5db',
    borderRadius: 4, fontSize: '0.8rem', background: '#fff', cursor: 'pointer',
  }

  return (
    <div style={{ padding: '1.5rem', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>Students</h2>
          {!loading && (
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: '#6b7280' }}>
              {total} student{total !== 1 ? 's' : ''}
              {filters.class_id && selectedClass ? ` in ${selectedClass.name}` : ''}
            </p>
          )}
        </div>
        <button
          onClick={() => setShowForm(true)}
          style={{ padding: '0.5rem 1rem', background: '#14463A', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem', fontWeight: 500 }}
        >
          + Add Student
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <StudentForm
          academicYears={academicYears}
          classes={classes}
          onCreated={() => { setShowForm(false); setFilters((f) => ({ ...f })) }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.875rem', flexWrap: 'wrap' }}>
        <select value={filters.academic_year_id ?? ''} onChange={(e) => setFilter('academic_year_id', (e.target as HTMLSelectElement).value)} style={SELECT}>
          <option value="">All years</option>
          {academicYears.map((y) => (
            <option key={y.id} value={y.id}>{y.name}{y.is_current ? ' ★' : ''}</option>
          ))}
        </select>
        <select value={filters.class_id ?? ''} onChange={(e) => setFilter('class_id', (e.target as HTMLSelectElement).value)} style={SELECT}>
          <option value="">All classes</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filters.section_id ?? ''} onChange={(e) => setFilter('section_id', (e.target as HTMLSelectElement).value)} style={SELECT} disabled={!filters.class_id}>
          <option value="">All sections</option>
          {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {/* Error */}
      {error && <p style={{ color: '#c00', fontSize: '0.875rem' }}>{error}</p>}

      {/* Table */}
      {loading ? (
        <p style={{ color: '#9ca3af', fontSize: '0.875rem' }}>Loading…</p>
      ) : students.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: '#9ca3af', fontSize: '0.875rem', background: '#f9fafb', borderRadius: 8 }}>
          No students found. Click <strong>+ Add Student</strong> to begin.
        </div>
      ) : (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <TableHeader />
          {students.length > 50 ? (
            <VirtualList
              items={students}
              rowHeight={ROW_HEIGHT}
              containerHeight={LIST_HEIGHT}
              keyFn={(s) => s.id}
              renderRow={(s) => <StudentRow student={s} />}
            />
          ) : (
            <div>
              {students.map((s) => <StudentRow key={s.id} student={s} />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
