import { useEffect, useState } from 'preact/hooks'
import { VirtualList } from '../components/VirtualList'
import { useIsMobile } from '../hooks/useIsMobile'
import { listAcademicYears, listClasses, listStudents, updateStudent } from '../api/students'
import { StudentForm } from './StudentForm'
import { ExcelImport } from '../ui'
import type { AcademicYear, Class, Student, StudentFilters } from '../types/student'

type FlagField = 'is_transport' | 'is_hosteler'

// Inline pill toggle for a student flag — filled when on, outlined when off.
function FlagChip({ on, label, busy, onClick }: { on: boolean; label: string; busy: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick} disabled={busy} title={`Toggle ${label}`}
      style={{
        padding: '2px 9px', borderRadius: 9999, fontSize: '0.68rem', fontWeight: 600,
        cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', opacity: busy ? 0.5 : 1,
        border: on ? '1px solid transparent' : '1px solid var(--gray-300)',
        background: on ? 'var(--c-primary-lt)' : 'transparent',
        color: on ? 'var(--c-primary)' : 'var(--gray-400)',
      }}
    >
      {label}
    </button>
  )
}

const ROW_HEIGHT = 56
const ROW_HEIGHT_MOBILE = 104
const LIST_HEIGHT = 520

function EditButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick} title="Edit student"
      style={{
        padding: '2px 9px', borderRadius: 9999, fontSize: '0.68rem', fontWeight: 600,
        cursor: 'pointer', fontFamily: 'inherit', border: '1px solid var(--gray-300)',
        background: 'transparent', color: 'var(--gray-400)',
      }}
    >
      Edit
    </button>
  )
}

function StudentRow({ student, busy, onToggle, onEdit, mobile }: {
  student: Student
  busy: boolean
  onToggle: (id: string, field: FlagField, value: boolean) => void
  onEdit: (student: Student) => void
  mobile: boolean
}) {
  const chips = (
    <>
      <FlagChip on={student.is_transport} label="Transport" busy={busy} onClick={() => onToggle(student.id, 'is_transport', !student.is_transport)} />
      <FlagChip on={student.is_hosteler} label="Hosteler" busy={busy} onClick={() => onToggle(student.id, 'is_hosteler', !student.is_hosteler)} />
      <EditButton onClick={() => onEdit(student)} />
    </>
  )

  // Phone: stacked card — name line, muted detail line, then chips. No fixed
  // column widths, so nothing overflows a narrow screen.
  if (mobile) {
    return (
      <div style={{
        height: ROW_HEIGHT_MOBILE, display: 'flex', flexDirection: 'column',
        justifyContent: 'center', gap: '0.35rem', padding: '0.5rem 0.9rem',
        borderBottom: '1px solid #f3f4f6', background: '#fff', fontSize: '0.8rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', minWidth: 0 }}>
          <span style={{ fontWeight: 700, color: '#14463A', flexShrink: 0 }}>#{student.roll_number}</span>
          <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {student.first_name} {student.last_name}
          </span>
        </div>
        <div style={{ color: '#6b7280', fontSize: '0.72rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          <span>{student.admission_no}</span><span aria-hidden>·</span>
          <span>{student.gender}</span><span aria-hidden>·</span>
          <span>{student.parent_phone}</span>
        </div>
        <div style={{ display: 'flex', gap: '0.35rem' }}>{chips}</div>
      </div>
    )
  }

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
      <span style={{ width: 210, display: 'flex', gap: '0.35rem', justifyContent: 'flex-end', flexShrink: 0 }}>
        {chips}
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
      <span style={{ width: 210, flexShrink: 0, textAlign: 'right' }}>TRANSPORT · HOSTEL · EDIT</span>
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
  const [editingStudent, setEditingStudent] = useState<Student | null>(null)
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

  const isMobile = useIsMobile()
  const rowHeight = isMobile ? ROW_HEIGHT_MOBILE : ROW_HEIGHT
  const listHeight = isMobile ? 600 : LIST_HEIGHT
  const [togglingId, setTogglingId] = useState('')

  // Flip a student flag (transport/hosteler) inline. Optimistic, reverts on error.
  // NOTE: changing is_transport only affects future ledger generation — re-run
  // "Generate Ledger" to apply/remove the transport fee for newly-flagged students.
  async function onToggleFlag(id: string, field: FlagField, value: boolean) {
    setTogglingId(id); setError('')
    setStudents((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)))
    try {
      await updateStudent(id, { [field]: value })
    } catch (e) {
      setStudents((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: !value } : s)))
      setError(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setTogglingId('')
    }
  }

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
    <div style={{ padding: isMobile ? '1rem 0.75rem' : '1.5rem', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: '.5rem', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>Students</h2>
          {!loading && (
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: '#6b7280' }}>
              {total} student{total !== 1 ? 's' : ''}
              {filters.class_id && selectedClass ? ` in ${selectedClass.name}` : ''}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
          <ExcelImport
            endpoint="/students/import"
            query={{ academic_year_id: filters.academic_year_id }}
            columns="Admission No, First Name, Last Name, Class, Section, Roll No, Date of Birth, Gender, Parent Phone (optional: Hosteler, Transport)"
            disabledReason={filters.academic_year_id ? undefined : 'Select an academic year first.'}
            onImported={() => setFilters((f) => ({ ...f }))}
          />
          <button
            onClick={() => { setEditingStudent(null); setShowForm(true) }}
            style={{ padding: '0.5rem 1rem', background: '#14463A', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem', fontWeight: 500 }}
          >
            + Add Student
          </button>
        </div>
      </div>

      {/* Add / Edit form */}
      {(showForm || editingStudent) && (
        <StudentForm
          academicYears={academicYears}
          classes={classes}
          student={editingStudent ?? undefined}
          onSaved={() => { setShowForm(false); setEditingStudent(null); setFilters((f) => ({ ...f })) }}
          onCancel={() => { setShowForm(false); setEditingStudent(null) }}
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
          {!isMobile && <TableHeader />}
          {students.length > 50 ? (
            <VirtualList
              items={students}
              rowHeight={rowHeight}
              containerHeight={listHeight}
              keyFn={(s) => s.id}
              renderRow={(s) => <StudentRow student={s} busy={togglingId === s.id} onToggle={onToggleFlag} onEdit={setEditingStudent} mobile={isMobile} />}
            />
          ) : (
            <div>
              {students.map((s) => <StudentRow key={s.id} student={s} busy={togglingId === s.id} onToggle={onToggleFlag} onEdit={setEditingStudent} mobile={isMobile} />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
