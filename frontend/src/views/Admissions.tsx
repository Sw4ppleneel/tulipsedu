import { useEffect, useState } from 'preact/hooks'
import { listAdmissions, advanceStatus, enrolStudent } from '../api/admissions'
import type { Admission, AdmissionStatus } from '../api/admissions'
import { listAcademicYears, listClasses } from '../api/students'
import type { AcademicYear, Class, Section } from '../types/student'
import { isValidIndianMobile, INVALID_PHONE_MSG } from '../utils/phone'

const COLUMNS: { status: AdmissionStatus; label: string; color: string; bg: string }[] = [
  { status: 'enquiry',     label: 'Enquiry',      color: '#374151', bg: '#f9fafb' },
  { status: 'application', label: 'Application',  color: '#92400e', bg: '#fffbeb' },
  { status: 'docs_pending',label: 'Docs Pending', color: '#1e40af', bg: '#eff6ff' },
  { status: 'approved',    label: 'Approved',     color: '#065f46', bg: '#ecfdf5' },
  { status: 'enrolled',    label: 'Enrolled',     color: '#14463A', bg: '#d1fae5' },
]

const NEXT_STATUS: Record<AdmissionStatus, AdmissionStatus | null> = {
  enquiry:     'application',
  application: 'docs_pending',
  docs_pending:'approved',
  approved:    'enrolled',
  enrolled:    null,
  rejected:    null,
}

const NEXT_LABEL: Record<AdmissionStatus, string> = {
  enquiry:     'Mark as Application',
  application: 'Docs Received',
  docs_pending:'Approve',
  approved:    'Enrol Student',
  enrolled:    '',
  rejected:    '',
}

function StatusChip({ status }: { status: AdmissionStatus }) {
  const col = COLUMNS.find(c => c.status === status)
  if (!col) return <span>{status}</span>
  return (
    <span style={{ padding: '2px 8px', borderRadius: 9999, fontSize: '0.7rem', fontWeight: 700, color: col.color, background: col.bg, border: `1px solid ${col.color}22` }}>
      {col.label.toUpperCase()}
    </span>
  )
}

function EnrolModal({
  admission,
  onClose,
  onDone,
}: {
  admission: Admission
  onClose: () => void
  onDone: (result: { adm_no: string }) => void
}) {
  const [years, setYears] = useState<AcademicYear[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [yearId, setYearId] = useState('')
  const [classId, setClassId] = useState('')
  const [sectionId, setSectionId] = useState('')
  const [rollNo, setRollNo] = useState('')
  const [admNo, setAdmNo] = useState('')
  const [gender, setGender] = useState('')
  const [phone, setPhone] = useState(admission.parent_phone ?? '')
  const [dob, setDob] = useState(admission.applicant_dob ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([listAcademicYears(), listClasses()]).then(([ys, cs]) => {
      setYears(ys)
      setClasses(cs)
      const cur = ys.find(y => y.is_current)
      if (cur) setYearId(cur.id)
    })
  }, [])

  const selectedClass = classes.find(c => c.id === classId)

  async function submit(e: Event) {
    e.preventDefault()
    if (!yearId || !classId || !sectionId) { setError('Select year, class and section'); return }
    if (!rollNo.trim()) { setError('Roll number is required'); return }
    if (!gender) { setError('Select gender'); return }
    if (!isValidIndianMobile(phone)) { setError(INVALID_PHONE_MSG); return }
    if (!dob) { setError('Date of birth is required'); return }
    setBusy(true); setError('')
    try {
      const r = await enrolStudent(admission.id, {
        academic_year_id: yearId,
        class_id: classId,
        section_id: sectionId,
        roll_number: rollNo.trim(),
        gender,
        parent_phone: phone.trim(),
        date_of_birth: dob,
        adm_no: admNo.trim() || undefined,
      })
      onDone({ adm_no: r.adm_no })
    } catch (e) { setError(e instanceof Error ? e.message : 'Enrolment failed') }
    finally { setBusy(false) }
  }

  const INP: preact.JSX.CSSProperties = { padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.875rem', width: '100%' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
      <div style={{ background: '#fff', borderRadius: 10, padding: '1.5rem', width: 420, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 0.25rem', fontSize: '1rem' }}>Enrol Student</h3>
        <p style={{ margin: '0 0 1rem', fontSize: '0.8rem', color: '#6b7280' }}>{admission.applicant_name}</p>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <select value={yearId} onChange={e => setYearId((e.target as HTMLSelectElement).value)} style={INP} required>
            <option value="">Academic year *</option>
            {years.map(y => <option key={y.id} value={y.id}>{y.name}{y.is_current ? ' ★' : ''}</option>)}
          </select>
          <select value={classId} onChange={e => { setClassId((e.target as HTMLSelectElement).value); setSectionId('') }} style={INP} required>
            <option value="">Class *</option>
            {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {selectedClass && (
            <select value={sectionId} onChange={e => setSectionId((e.target as HTMLSelectElement).value)} style={INP} required>
              <option value="">Section *</option>
              {selectedClass.sections.map((s: Section) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <input value={rollNo} onInput={e => setRollNo((e.target as HTMLInputElement).value)} placeholder="Roll number *" style={INP} required />
          <select value={gender} onChange={e => setGender((e.target as HTMLSelectElement).value)} style={INP} required>
            <option value="">Gender *</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
            <option value="Other">Other</option>
          </select>
          <input value={phone} onInput={e => setPhone((e.target as HTMLInputElement).value)} placeholder="Parent phone (10 digits) *" style={INP} inputMode="numeric" maxLength={10} required />
          <input type="date" value={dob} onInput={e => setDob((e.target as HTMLInputElement).value)} style={INP} required />
          <input value={admNo} onInput={e => setAdmNo((e.target as HTMLInputElement).value)} placeholder="Admission no. (auto-generated if blank)" style={INP} />
          {error && <p style={{ color: '#c00', fontSize: '0.8rem', margin: 0 }}>{error}</p>}
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
            <button type="submit" disabled={busy} style={{ flex: 1, padding: '0.625rem', background: busy ? '#9ca3af' : '#14463A', color: '#fff', border: 'none', borderRadius: 4, cursor: busy ? 'default' : 'pointer', fontWeight: 600, fontSize: '0.875rem' }}>
              {busy ? 'Enrolling…' : 'Enrol'}
            </button>
            <button type="button" onClick={onClose} style={{ padding: '0.625rem 1rem', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem' }}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function AdmissionCard({
  adm,
  onAdvance,
  onReject,
  onEnrol,
}: {
  adm: Admission
  onAdvance: (id: string, status: AdmissionStatus) => void
  onReject: (id: string) => void
  onEnrol: (adm: Admission) => void
}) {
  const next = NEXT_STATUS[adm.status]
  const isEnrol = next === 'enrolled'

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.75rem', marginBottom: '0.5rem', fontSize: '0.8rem' }}>
      <div style={{ fontWeight: 600, marginBottom: 2 }}>{adm.applicant_name}</div>
      {adm.class_name && <div style={{ color: '#6b7280', marginBottom: 2 }}>Applying for: {adm.class_name}</div>}
      {adm.parent_phone && <div style={{ color: '#6b7280', marginBottom: 2 }}>📞 {adm.parent_phone}</div>}
      {adm.notes && <div style={{ color: '#9ca3af', fontSize: '0.75rem', marginBottom: '0.5rem', fontStyle: 'italic' }}>{adm.notes}</div>}
      <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
        <span>{new Date(adm.created_at).toLocaleDateString('en-IN')}</span>
        {adm.public_enquiry && <span>· web</span>}
        {(() => {
          const days = Math.floor((Date.now() - new Date(adm.updated_at).getTime()) / 86_400_000)
          if (days < 3) return null
          const color = days >= 6 ? '#dc2626' : '#d97706'
          const bg    = days >= 6 ? '#fee2e2' : '#fef3c7'
          return (
            <span style={{ fontSize: '0.68rem', fontWeight: 700, background: bg, color, borderRadius: 9999, padding: '1px 6px' }}>
              {days}d in {adm.status}
            </span>
          )
        })()}
      </div>
      {adm.status !== 'enrolled' && adm.status !== 'rejected' && (
        <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
          {next && (
            <button
              onClick={() => isEnrol ? onEnrol(adm) : onAdvance(adm.id, next)}
              style={{ padding: '0.25rem 0.625rem', background: '#14463A', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600 }}>
              {NEXT_LABEL[adm.status]}
            </button>
          )}
          <button onClick={() => onReject(adm.id)} style={{ padding: '0.25rem 0.625rem', background: '#fee2e2', color: '#991b1b', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.72rem' }}>
            Reject
          </button>
        </div>
      )}
      {adm.status === 'rejected' && adm.rejected_reason && (
        <div style={{ color: '#dc2626', fontSize: '0.72rem' }}>Rejected: {adm.rejected_reason}</div>
      )}
    </div>
  )
}

export function AdmissionsView() {
  const [admissions, setAdmissions] = useState<Admission[]>([])
  const [loading, setLoading] = useState(true)
  const [showRejected, setShowRejected] = useState(false)
  const [enrolTarget, setEnrolTarget] = useState<Admission | null>(null)
  const [successMsg, setSuccessMsg] = useState('')

  async function load() {
    setLoading(true)
    try {
      const all = await listAdmissions()
      setAdmissions(all)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function handleAdvance(id: string, status: AdmissionStatus) {
    await advanceStatus(id, status)
    load()
  }

  async function handleReject(id: string) {
    const reason = prompt('Rejection reason (optional):') ?? ''
    await advanceStatus(id, 'rejected', reason || undefined)
    load()
  }

  function handleEnrolDone(result: { adm_no: string }) {
    setEnrolTarget(null)
    setSuccessMsg(`Student enrolled! Admission number: ${result.adm_no}`)
    load()
  }

  const active = admissions.filter(a => a.status !== 'rejected')
  const rejected = admissions.filter(a => a.status === 'rejected')

  return (
    <div style={{ padding: '1.5rem', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>Admissions Pipeline</h2>
        <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>{active.length} active · {rejected.length} rejected</span>
      </div>

      {successMsg && (
        <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 6, fontSize: '0.875rem', color: '#065f46', fontWeight: 600 }}>
          ✓ {successMsg}
          <button onClick={() => setSuccessMsg('')} style={{ marginLeft: '1rem', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', color: '#6b7280' }}>✕</button>
        </div>
      )}

      {loading ? <p style={{ color: '#9ca3af', fontSize: '0.875rem' }}>Loading…</p> : (
        <>
          {/* Kanban board — horizontal scroll on small screens */}
          <div style={{ display: 'flex', gap: '1rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
            {COLUMNS.map((col) => {
              const cards = active.filter(a => a.status === col.status)
              return (
                <div key={col.status} style={{ minWidth: 210, maxWidth: 240, flex: '0 0 210px' }}>
                  <div style={{ padding: '0.5rem 0.625rem', borderRadius: '6px 6px 0 0', background: col.bg, borderBottom: `2px solid ${col.color}44`, marginBottom: '0.5rem' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.8rem', color: col.color }}>{col.label.toUpperCase()}</span>
                    <span style={{ marginLeft: '0.5rem', background: col.color, color: '#fff', borderRadius: 9999, fontSize: '0.7rem', padding: '1px 7px' }}>{cards.length}</span>
                  </div>
                  {cards.length === 0 && <p style={{ color: '#d1d5db', fontSize: '0.75rem', textAlign: 'center', padding: '1rem 0' }}>Empty</p>}
                  {cards.map(a => (
                    <AdmissionCard
                      key={a.id}
                      adm={a}
                      onAdvance={handleAdvance}
                      onReject={handleReject}
                      onEnrol={(adm) => setEnrolTarget(adm)}
                    />
                  ))}
                </div>
              )
            })}
          </div>

          {/* Rejected toggle */}
          {rejected.length > 0 && (
            <div style={{ marginTop: '1.5rem' }}>
              <button onClick={() => setShowRejected(!showRejected)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8rem', color: '#9ca3af', padding: 0 }}>
                {showRejected ? '▲' : '▼'} {rejected.length} rejected application{rejected.length !== 1 ? 's' : ''}
              </button>
              {showRejected && (
                <div style={{ marginTop: '0.75rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: '0.5rem' }}>
                  {rejected.map(a => (
                    <div key={a.id} style={{ background: '#fef9f9', border: '1px solid #fecaca', borderRadius: 6, padding: '0.625rem', fontSize: '0.8rem' }}>
                      <div style={{ fontWeight: 600 }}>{a.applicant_name}</div>
                      <StatusChip status="rejected" />
                      {a.rejected_reason && <div style={{ marginTop: '0.25rem', color: '#dc2626', fontSize: '0.75rem' }}>{a.rejected_reason}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {enrolTarget && (
        <EnrolModal
          admission={enrolTarget}
          onClose={() => setEnrolTarget(null)}
          onDone={handleEnrolDone}
        />
      )}
    </div>
  )
}
