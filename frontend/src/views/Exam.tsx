import { useEffect, useState } from 'preact/hooks'
import {
  listSubjects, createSubject, deleteSubject, listTerms, createTerm, listMarksConfig, getMarks, saveMarks, getTermResults,
  listComponents, configureComponents, getComponentGrid, saveComponentMarks,
  transitionTermStatus, downloadReportCard,
} from '../api/exam'
import { listAcademicYears, listClasses, listStudents } from '../api/students'
import { getAssignedClasses } from '../api/teacher'
import { restoreAuthState, getSectionLabel } from '../api/auth_state'
import type {
  ExamSubject, ExamTerm, MarksConfig, StudentTermResult, MarkEntry,
  ExamComponent, StudentComponentRow,
} from '../api/exam'
import type { AcademicYear, Class, Section } from '../types/student'

// ── Lifecycle helpers ─────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', marks_open: 'Open', locked: 'Locked', published: 'Published',
}
const STATUS_COLOR: Record<string, { bg: string; fg: string }> = {
  draft:      { bg: '#f3f4f6', fg: '#6b7280' },
  marks_open: { bg: '#d1fae5', fg: '#0D332A' },
  locked:     { bg: '#fef3c7', fg: '#92400e' },
  published:  { bg: '#dbeafe', fg: '#1e40af' },
}
const NEXT_ACTION: Record<string, { label: string; next: string; btnBg: string }[]> = {
  draft:      [{ label: 'Open for Marks Entry', next: 'marks_open', btnBg: '#1F8A5D' }],
  marks_open: [{ label: 'Lock Marks', next: 'locked', btnBg: '#d97706' }],
  locked:     [
    { label: 'Publish Results', next: 'published', btnBg: '#1d4ed8' },
    { label: 'Reopen for Edits', next: 'marks_open', btnBg: '#6b7280' },
  ],
  published:  [{ label: 'Reopen (Locked)', next: 'locked', btnBg: '#6b7280' }],
}

function StatusChip({ status }: { status: string }) {
  const c = STATUS_COLOR[status] ?? STATUS_COLOR.draft
  return (
    <span style={{ padding: '2px 8px', borderRadius: 9999, fontSize: '0.7rem', fontWeight: 700, background: c.bg, color: c.fg, letterSpacing: '0.03em' }}>
      {STATUS_LABEL[status] ?? status.toUpperCase()}
    </span>
  )
}

// ── Tab: Terms Management ─────────────────────────────────────────────────────

function TermsTab({
  terms, onUpdate, onAdd, canManage, academicYearId,
}: {
  terms: ExamTerm[]
  onUpdate: (updated: ExamTerm) => void
  onAdd: (created: ExamTerm) => void
  canManage: boolean
  academicYearId: string | null
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [err, setErr] = useState('')

  async function advance(termId: string, nextStatus: string) {
    setBusy(termId); setErr('')
    try {
      const updated = await transitionTermStatus(termId, nextStatus)
      onUpdate(updated)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Transition failed')
    } finally { setBusy(null) }
  }

  async function addTerm() {
    if (!academicYearId) return
    setAdding(true); setErr('')
    try {
      const n = terms.length + 1
      const created = await createTerm({
        academic_year_id: academicYearId,
        name: `Term ${n}`,
        term_type: 'term',
        sort_order: n - 1,
      })
      onAdd(created)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create term')
    } finally { setAdding(false) }
  }

  return (
    <div>
      {err && <p style={{ color: '#dc2626', fontSize: '0.8rem', marginBottom: '0.75rem' }}>{err}</p>}
      {terms.length === 0 && <p style={{ color: '#9ca3af', fontSize: '0.875rem', marginBottom: '0.75rem' }}>No exam terms yet.</p>}
      {terms.length > 0 && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', padding: '0 1rem', height: 36, background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontSize: '0.72rem', fontWeight: 600, color: '#6b7280', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ flex: 1 }}>TERM</span>
            <span style={{ width: 90 }}>STATUS</span>
            {canManage && <span style={{ width: 260 }}>ACTIONS</span>}
          </div>
          {terms.map(t => {
            const actions = NEXT_ACTION[t.status] ?? []
            return (
              <div key={t.id} style={{ display: 'flex', padding: '0.625rem 1rem', borderBottom: '1px solid #f3f4f6', gap: '0.75rem', alignItems: 'center', fontSize: '0.8rem' }}>
                <span style={{ flex: 1, fontWeight: 500 }}>{t.name}</span>
                <span style={{ width: 90 }}><StatusChip status={t.status ?? (t.is_published ? 'published' : 'draft')} /></span>
                {canManage && (
                  <div style={{ width: 260, display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                    {actions.map(a => (
                      <button key={a.next} onClick={() => advance(t.id, a.next)} disabled={busy === t.id}
                        style={{ padding: '0.3rem 0.625rem', background: a.btnBg, color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, opacity: busy === t.id ? 0.6 : 1 }}>
                        {busy === t.id ? '…' : a.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      {canManage && (
        <button onClick={addTerm} disabled={adding || !academicYearId}
          style={{ padding: '0.4rem 1rem', background: '#14463A', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, opacity: adding ? 0.6 : 1 }}>
          {adding ? 'Adding…' : '+ Add Term'}
        </button>
      )}
      <p style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: '#9ca3af' }}>
        Lifecycle: <strong>Draft</strong> → <strong>Open</strong> (teachers enter marks) → <strong>Locked</strong> (no more edits) → <strong>Published</strong> (parents see results). Principal can reopen a locked/published term if needed.
      </p>
    </div>
  )
}

// ── Tab: Manage Subjects ──────────────────────────────────────────────────────

function SubjectsTab({
  subjects, classes, academicYearId, onAdd, onRemove,
}: {
  subjects: ExamSubject[]
  classes: Class[]
  academicYearId: string | null
  onAdd: (s: ExamSubject) => void
  onRemove: (id: string) => void
}) {
  const [cls, setCls] = useState('')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState('')
  const [err, setErr] = useState('')

  async function removeSubject(s: ExamSubject) {
    if (!confirm(`Remove "${s.name}" from this class? Existing marks for it are kept.`)) return
    setRemoving(s.id); setErr('')
    try {
      await deleteSubject(s.id)
      onRemove(s.id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to remove subject')
    } finally { setRemoving('') }
  }

  const clsSubjects = subjects.filter(s => s.class_id === cls)
  const INP: preact.JSX.CSSProperties = { padding: '0.375rem 0.5rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.8rem' }
  const LBL: preact.JSX.CSSProperties = { fontSize: '0.7rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 2 }

  async function addSubject() {
    if (!cls || !name.trim() || !academicYearId) return
    setAdding(true); setErr('')
    try {
      const created = await createSubject({
        academic_year_id: academicYearId,
        class_id: cls,
        name: name.trim(),
        subject_code: code.trim() || undefined,
        sort_order: clsSubjects.length,
      })
      onAdd(created)
      setName(''); setCode('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create subject')
    } finally { setAdding(false) }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.625rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label style={LBL}>Class</label>
          <select value={cls} onChange={e => setCls((e.target as HTMLSelectElement).value)} style={{ ...INP, minWidth: 120 }}>
            <option value="">— select —</option>
            {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label style={LBL}>Subject Name</label>
          <input value={name} onInput={e => setName((e.target as HTMLInputElement).value)} placeholder="e.g. Mathematics"
            style={{ ...INP, minWidth: 160 }} />
        </div>
        <div>
          <label style={LBL}>Code (optional)</label>
          <input value={code} onInput={e => setCode((e.target as HTMLInputElement).value)} placeholder="e.g. MATH"
            style={{ ...INP, width: 90 }} />
        </div>
        <button onClick={addSubject} disabled={adding || !cls || !name.trim() || !academicYearId}
          style={{ padding: '0.4rem 1rem', background: '#14463A', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, opacity: adding || !cls || !name.trim() ? 0.6 : 1 }}>
          {adding ? 'Adding…' : '+ Add Subject'}
        </button>
      </div>
      {err && <p style={{ color: '#dc2626', fontSize: '0.8rem', marginBottom: '0.5rem' }}>{err}</p>}

      {!cls && <p style={{ color: '#9ca3af', fontSize: '0.875rem' }}>Select a class to view and add subjects.</p>}

      {cls && clsSubjects.length === 0 && (
        <p style={{ color: '#9ca3af', fontSize: '0.875rem' }}>No subjects yet for this class. Add one above.</p>
      )}

      {cls && clsSubjects.length > 0 && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ display: 'flex', padding: '0 1rem', height: 34, background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontSize: '0.72rem', fontWeight: 600, color: '#6b7280', alignItems: 'center', gap: '1rem' }}>
            <span style={{ flex: 1 }}>SUBJECT</span>
            <span style={{ width: 80 }}>CODE</span>
            <span style={{ width: 70, textAlign: 'right' }}></span>
          </div>
          {clsSubjects.map(s => (
            <div key={s.id} style={{ display: 'flex', padding: '0.5rem 1rem', borderBottom: '1px solid #f3f4f6', gap: '1rem', alignItems: 'center', fontSize: '0.82rem' }}>
              <span style={{ flex: 1, fontWeight: 500 }}>{s.name}</span>
              <span style={{ width: 80, color: '#9ca3af' }}>{s.subject_code ?? '—'}</span>
              <span style={{ width: 70, textAlign: 'right' }}>
                <button onClick={() => removeSubject(s)} disabled={removing === s.id}
                  style={{ padding: '0.2rem 0.5rem', background: 'none', border: '1px solid #fecaca', color: '#dc2626', borderRadius: 4, cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600, opacity: removing === s.id ? 0.6 : 1 }}>
                  {removing === s.id ? '…' : 'Remove'}
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const GRADE_COLOR: Record<string, string> = {
  A1: '#0D332A', A2: '#0D332A', B1: '#0D332A', B2: '#0D332A',
  C1: '#92400e', C2: '#92400e', D: '#7c3aed', E: '#dc2626', AB: '#6b7280',
}

// ── Tab: Marks Entry ──────────────────────────────────────────────────────────

interface PendingEntry { student_id: string; student_name: string; roll_number: string; marks: string; absent: boolean }
interface CompDef { name: string; max_marks: string; weightage: string }

const DEFAULT_DEFS: CompDef[] = [
  { name: 'Unit Test', max_marks: '10', weightage: '10' },
  { name: 'Oral', max_marks: '10', weightage: '10' },
  { name: 'Theory', max_marks: '80', weightage: '80' },
]

function MarksEntryTab({
  terms, subjects, classes, role,
}: {
  terms: ExamTerm[]
  subjects: ExamSubject[]
  classes: Class[]
  role?: string
}) {
  const [term, setTerm] = useState('')
  const [cls, setCls] = useState('')
  const [sec, setSec] = useState('')
  const [subject, setSubject] = useState('')
  const [configs, setConfigs] = useState<MarksConfig[]>([])
  const [rows, setRows] = useState<PendingEntry[]>([])
  // Component state
  const [components, setComponents] = useState<ExamComponent[]>([])
  const [grid, setGrid] = useState<StudentComponentRow[]>([])
  const [showConfig, setShowConfig] = useState(false)
  const [defs, setDefs] = useState<CompDef[]>(DEFAULT_DEFS)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [lastSaved, setLastSaved] = useState('')
  const [err, setErr] = useState('')

  const sections: Section[] = classes.find(c => c.id === cls)?.sections ?? []
  const clsSubjects = subjects.filter(s => s.class_id === cls)
  const selectedConfig = configs.find(c => c.exam_subject_id === subject)
  const hasComponents = components.length > 0
  const ready = term && subject && cls && sec

  useEffect(() => {
    if (!term) return
    listMarksConfig(term).then(setConfigs)
  }, [term])

  async function loadAll() {
    if (!ready) { setRows([]); setComponents([]); setGrid([]); return }
    setLoading(true); setErr(''); setShowConfig(false)
    try {
      const comps = await listComponents(term, subject)
      setComponents(comps)
      if (comps.length > 0) {
        const g = await getComponentGrid({ exam_term_id: term, exam_subject_id: subject, class_id: cls, section_id: sec })
        setGrid(g.students)
        setDefs(comps.map(c => ({ name: c.name, max_marks: c.max_marks, weightage: c.weightage })))
        setRows([])
      } else {
        const existing: MarkEntry[] = await getMarks({ exam_term_id: term, exam_subject_id: subject, class_id: cls, section_id: sec })
        const entryMap = new Map(existing.map(e => [e.student_id, e]))
        const studentsResp = await listStudents({ class_id: cls, section_id: sec, limit: 200 })
        setRows(studentsResp.items.map(s => {
          const e = entryMap.get(s.id)
          return {
            student_id: s.id, student_name: `${s.first_name} ${s.last_name}`,
            roll_number: s.roll_number ?? '', marks: e?.marks_obtained ?? '', absent: e?.is_absent ?? false,
          }
        }))
        setGrid([]); setDefs(DEFAULT_DEFS)
      }
    } catch (ex) { setErr(ex instanceof Error ? ex.message : 'Failed to load') }
    finally { setLoading(false) }
  }

  useEffect(() => { loadAll() }, [term, subject, cls, sec])

  async function saveComponentDefs() {
    if (!ready) return
    setErr('')
    const parsed = defs
      .filter(d => d.name.trim() && d.max_marks !== '')
      .map((d, i) => ({ name: d.name.trim(), max_marks: +d.max_marks, weightage: +(d.weightage || d.max_marks), sort_order: i + 1 }))
    if (parsed.length === 0) { setErr('Add at least one component'); return }
    try {
      await configureComponents({ exam_term_id: term, exam_subject_id: subject, components: parsed })
      await loadAll()
    } catch (ex) { setErr(ex instanceof Error ? ex.message : 'Failed to save components') }
  }

  function stampSaved() {
    const auth = restoreAuthState()
    const name = auth?.firstName || 'you'
    const now = new Date()
    const d = now.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    const t = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    setLastSaved(`Last saved by ${name} on ${d} at ${t}`)
  }

  async function handleSaveFlat() {
    const maxM = selectedConfig ? +selectedConfig.max_marks : null
    if (maxM != null) {
      const invalid = rows.find(r => !r.absent && r.marks !== '' && +r.marks > maxM)
      if (invalid) {
        setErr(`${invalid.student_name}: marks ${invalid.marks} exceed maximum ${maxM}`)
        return
      }
    }
    setSaving(true); setSaved(false); setErr('')
    try {
      const entries = rows.map(r => ({
        student_id: r.student_id, exam_subject_id: subject,
        marks_obtained: r.absent ? null : (r.marks === '' ? null : +r.marks), is_absent: r.absent,
      }))
      await saveMarks({ exam_term_id: term, class_id: cls || undefined, section_id: sec || undefined, entries })
      setSaved(true); stampSaved(); setTimeout(() => setSaved(false), 3000)
    } catch (ex) { setErr(ex instanceof Error ? ex.message : 'Save failed') }
    finally { setSaving(false) }
  }

  async function handleSaveComponents() {
    for (const r of grid) {
      if (!r.is_absent) {
        for (const c of components) {
          const m = r.marks[c.id]
          if (m != null && m > +c.max_marks) {
            setErr(`${r.student_name}: marks for ${c.name} (${m}) exceed maximum ${+c.max_marks}`)
            return
          }
        }
      }
    }
    setSaving(true); setSaved(false); setErr('')
    try {
      const entries = grid.flatMap(r =>
        components.map(c => ({
          student_id: r.student_id, exam_component_id: c.id,
          marks_obtained: r.is_absent ? null : (r.marks[c.id] ?? null), is_absent: r.is_absent,
        }))
      )
      await saveComponentMarks({ exam_term_id: term, exam_subject_id: subject, class_id: cls || undefined, section_id: sec || undefined, entries })
      setSaved(true); stampSaved(); setTimeout(() => setSaved(false), 3000)
      await loadAll()
    } catch (ex) { setErr(ex instanceof Error ? ex.message : 'Save failed') }
    finally { setSaving(false) }
  }

  function updateRow(idx: number, patch: Partial<PendingEntry>) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r))
  }
  function updateCell(sid: string, compId: string, val: string) {
    setGrid(prev => prev.map(r => {
      if (r.student_id !== sid) return r
      const marks = { ...r.marks, [compId]: val === '' ? null : +val }
      const wTotal = components.reduce((s, c) => s + +c.weightage, 0)
      const wSum = components.reduce((s, c) => {
        const m = marks[c.id]
        return m != null ? s + m / +c.max_marks * +c.weightage : s
      }, 0)
      const total = wTotal > 0 ? Math.round(wSum / wTotal * 10000) / 100 : 0
      return { ...r, marks, total }
    }))
  }
  function setRowAbsent(sid: string, absent: boolean) {
    setGrid(prev => prev.map(r => r.student_id === sid ? { ...r, is_absent: absent } : r))
  }

  const INP: preact.JSX.CSSProperties = { padding: '0.375rem 0.5rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.8rem' }
  const LBL: preact.JSX.CSSProperties = { fontSize: '0.7rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 2 }
  const TH: preact.JSX.CSSProperties = { border: '1px solid #e5e7eb', padding: '0.375rem 0.625rem', textAlign: 'center', color: '#6b7280', fontWeight: 600 }
  const TD: preact.JSX.CSSProperties = { border: '1px solid #e5e7eb', padding: '0.3rem', textAlign: 'center' }
  const cellInput: preact.JSX.CSSProperties = { width: 56, padding: '0.25rem 0.375rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.8rem', textAlign: 'right' }
  const compMax = (id: string) => +(components.find(c => c.id === id)?.max_marks ?? 0)
  const totalMax = components.reduce((s, c) => s + +c.max_marks, 0)

  const selectedTerm = terms.find(t => t.id === term)
  const termStatus = selectedTerm?.status ?? 'draft'
  const isLocked = !!selectedTerm && termStatus !== 'marks_open'

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.625rem', marginBottom: '1rem' }}>
        <div>
          <label style={LBL}>Term</label>
          <select value={term} onChange={e => setTerm((e.target as HTMLSelectElement).value)} style={{ ...INP, width: '100%' }}>
            <option value="">— select —</option>
            {terms.map(t => <option key={t.id} value={t.id}>{t.name} — {STATUS_LABEL[t.status ?? 'draft'] ?? t.status}</option>)}
          </select>
        </div>
        <div>
          <label style={LBL}>Class</label>
          <select value={cls} onChange={e => { setCls((e.target as HTMLSelectElement).value); setSec('') }} style={{ ...INP, width: '100%' }}>
            <option value="">— select —</option>
            {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label style={LBL}>{getSectionLabel()}</label>
          <select value={sec} onChange={e => setSec((e.target as HTMLSelectElement).value)} style={{ ...INP, width: '100%' }} disabled={!cls}>
            <option value="">— select —</option>
            {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label style={LBL}>Subject</label>
          <select value={subject} onChange={e => setSubject((e.target as HTMLSelectElement).value)} style={{ ...INP, width: '100%' }} disabled={!cls}>
            <option value="">— select —</option>
            {clsSubjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>

      {/* Components configuration */}
      {ready && (
        <div style={{ marginBottom: '0.875rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem', color: '#6b7280' }}>
            {hasComponents ? (
              <span>Components: <strong>{components.map(c => `${c.name} (max ${+c.max_marks}, wt ${+c.weightage})`).join(' + ')}</strong> — scored /100</span>
            ) : (
              <span>No components set — entering a single mark out of {selectedConfig?.max_marks ?? '?'}.</span>
            )}
            <button onClick={() => setShowConfig(v => !v)} style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: 4, padding: '0.2rem 0.5rem', fontSize: '0.72rem', cursor: 'pointer', color: '#14463A' }}>
              {showConfig ? 'Close' : (hasComponents ? 'Edit components' : 'Set up components')}
            </button>
          </div>

          {showConfig && (
            <div style={{ marginTop: '0.625rem', padding: '0.875rem', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6 }}>
              <p style={{ margin: '0 0 0.5rem', fontSize: '0.74rem', color: '#6b7280' }}>
                Define components with a max marks and a weightage. The subject total is computed as a weighted percentage out of 100.
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.4rem', fontSize: '0.7rem', fontWeight: 600, color: '#6b7280' }}>
                <span style={{ flex: 1 }}>Name</span>
                <span style={{ width: 70, textAlign: 'center' }}>Max</span>
                <span style={{ width: 80, textAlign: 'center' }}>Weightage</span>
                <span style={{ width: 24 }} />
              </div>
              {defs.map((d, i) => (
                <div key={i} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.4rem', alignItems: 'center' }}>
                  <input value={d.name} placeholder="Component name"
                    onInput={e => setDefs(p => p.map((x, j) => j === i ? { ...x, name: (e.target as HTMLInputElement).value } : x))}
                    style={{ ...INP, flex: 1 }} />
                  <input type="number" min={1} value={d.max_marks} placeholder="Max"
                    onInput={e => setDefs(p => p.map((x, j) => j === i ? { ...x, max_marks: (e.target as HTMLInputElement).value } : x))}
                    style={{ ...INP, width: 70 }} />
                  <input type="number" min={1} value={d.weightage} placeholder="Wt"
                    onInput={e => setDefs(p => p.map((x, j) => j === i ? { ...x, weightage: (e.target as HTMLInputElement).value } : x))}
                    style={{ ...INP, width: 80 }} />
                  <button onClick={() => setDefs(p => p.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '1rem', width: 24 }}>×</button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.5rem' }}>
                <button onClick={() => setDefs(p => [...p, { name: '', max_marks: '', weightage: '' }])} style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: 4, padding: '0.3rem 0.625rem', fontSize: '0.75rem', cursor: 'pointer' }}>+ Add component</button>
                <span style={{ fontSize: '0.74rem', color: '#6b7280' }}>Total weightage: <strong>{defs.reduce((s, d) => s + (+d.weightage || 0), 0)}</strong></span>
                <button onClick={saveComponentDefs} style={{ marginLeft: 'auto', background: '#14463A', color: '#fff', border: 'none', borderRadius: 4, padding: '0.4rem 1rem', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>Save components</button>
              </div>
            </div>
          )}
        </div>
      )}

      {isLocked && (
        <div style={{ padding: '0.75rem 1rem', background: termStatus === 'published' ? '#dbeafe' : '#fef3c7', border: `1px solid ${termStatus === 'published' ? '#93c5fd' : '#fcd34d'}`, borderRadius: 6, marginBottom: '1rem', fontSize: '0.8rem', color: termStatus === 'published' ? '#1e40af' : '#92400e', fontWeight: 600 }}>
          {termStatus === 'published'
            ? 'Results are published — marks are read-only. Ask the principal to reopen if corrections are needed.'
            : `This term is ${STATUS_LABEL[termStatus] ?? termStatus} — marks entry is closed. Ask the principal to open it.`}
        </div>
      )}

      {err && <p style={{ color: '#ef4444', fontSize: '0.8rem', marginBottom: '0.5rem' }}>{err}</p>}
      {loading && <p style={{ color: '#6b7280', fontSize: '0.8rem' }}>Loading…</p>}

      {/* Component grid */}
      {!loading && hasComponents && grid.length > 0 && (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', marginBottom: '1rem' }}>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  <th style={{ ...TH, textAlign: 'left', width: 50 }}>Roll</th>
                  <th style={{ ...TH, textAlign: 'left' }}>Student</th>
                  <th style={{ ...TH, width: 60 }}>Absent</th>
                  {components.map(c => <th key={c.id} style={{ ...TH, width: 80 }}>{c.name}<br /><span style={{ fontWeight: 400, color: '#9ca3af' }}>/{+c.max_marks}</span></th>)}
                  <th style={{ ...TH, width: 80 }}>Total<br /><span style={{ fontWeight: 400, color: '#9ca3af' }}>/100</span></th>
                </tr>
              </thead>
              <tbody>
                {grid.map(r => (
                  <tr key={r.student_id} style={{ background: r.is_absent ? '#fef2f2' : '#fff' }}>
                    <td style={{ border: '1px solid #e5e7eb', padding: '0.3rem 0.625rem', color: '#6b7280' }}>{r.roll_number}</td>
                    <td style={{ border: '1px solid #e5e7eb', padding: '0.3rem 0.625rem', fontWeight: 500 }}>{r.student_name}</td>
                    <td style={TD}><input type="checkbox" checked={r.is_absent} onChange={e => setRowAbsent(r.student_id, (e.target as HTMLInputElement).checked)} /></td>
                    {components.map(c => (
                      <td key={c.id} style={TD}>
                        <input type="number" min={0} max={compMax(c.id)} step={0.5} disabled={r.is_absent}
                          value={r.marks[c.id] ?? ''} onInput={e => updateCell(r.student_id, c.id, (e.target as HTMLInputElement).value)}
                          style={cellInput} />
                      </td>
                    ))}
                    <td style={{ ...TD, fontWeight: 700, color: '#111827' }}>{r.is_absent ? 'AB' : (r.total ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button onClick={handleSaveComponents} disabled={saving || isLocked}
              style={{ padding: '0.5rem 1.25rem', background: isLocked ? '#9ca3af' : '#14463A', color: '#fff', border: 'none', borderRadius: 4, cursor: isLocked ? 'default' : 'pointer', fontSize: '0.875rem' }}>
              {saving ? 'Saving…' : 'Save Marks'}
            </button>
            {saved && <span style={{ color: '#1F8A5D', fontSize: '0.8rem', fontWeight: 600 }}>Saved</span>}
            {!saved && lastSaved && <span style={{ color: '#9ca3af', fontSize: '0.75rem' }}>{lastSaved}</span>}
          </div>
        </>
      )}

      {/* Flat single-mark grid (no components) */}
      {!loading && !hasComponents && rows.length > 0 && (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', marginBottom: '1rem' }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                <th style={{ ...TH, textAlign: 'left', width: 60 }}>Roll</th>
                <th style={{ ...TH, textAlign: 'left' }}>Student</th>
                <th style={{ ...TH, width: 80 }}>Absent</th>
                <th style={{ ...TH, width: 100 }}>Marks</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.student_id} style={{ background: r.absent ? '#fef2f2' : '#fff' }}>
                  <td style={{ border: '1px solid #e5e7eb', padding: '0.3rem 0.625rem', color: '#6b7280' }}>{r.roll_number}</td>
                  <td style={{ border: '1px solid #e5e7eb', padding: '0.3rem 0.625rem', fontWeight: 500 }}>{r.student_name}</td>
                  <td style={TD}>
                    <input type="checkbox" disabled={isLocked} checked={r.absent} onChange={e => updateRow(i, { absent: (e.target as HTMLInputElement).checked, marks: '' })} />
                  </td>
                  <td style={TD}>
                    <input type="number" min={0} max={selectedConfig ? +selectedConfig.max_marks : undefined} step={0.5}
                      value={r.marks} disabled={r.absent || isLocked}
                      onInput={e => updateRow(i, { marks: (e.target as HTMLInputElement).value })}
                      style={{ ...cellInput, width: 70 }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button onClick={handleSaveFlat} disabled={saving || isLocked}
              style={{ padding: '0.5rem 1.25rem', background: isLocked ? '#9ca3af' : '#14463A', color: '#fff', border: 'none', borderRadius: 4, cursor: isLocked ? 'default' : 'pointer', fontSize: '0.875rem' }}>
              {saving ? 'Saving…' : 'Save Marks'}
            </button>
            {saved && <span style={{ color: '#1F8A5D', fontSize: '0.8rem', fontWeight: 600 }}>Saved</span>}
            {!saved && lastSaved && <span style={{ color: '#9ca3af', fontSize: '0.75rem' }}>{lastSaved}</span>}
          </div>
        </>
      )}

      {!loading && ready && !hasComponents && rows.length === 0 && (
        <p style={{ color: '#9ca3af', fontSize: '0.8rem' }}>No students found in this class-section.</p>
      )}
      {!term && <p style={{ color: '#9ca3af', fontSize: '0.8rem' }}>Select term, class, section, and subject to enter marks.</p>}
    </div>
  )
}

// ── Tab: Results ──────────────────────────────────────────────────────────────

function ResultsTab({ terms, classes }: { terms: ExamTerm[]; classes: Class[] }) {
  const [term, setTerm] = useState('')
  const [cls, setCls] = useState('')
  const [sec, setSec] = useState('')
  const [results, setResults] = useState<StudentTermResult[]>([])
  const [termName, setTermName] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const sections: Section[] = classes.find(c => c.id === cls)?.sections ?? []

  async function load() {
    if (!term || !cls || !sec) return
    setLoading(true); setErr('')
    try {
      const sheet = await getTermResults({ exam_term_id: term, class_id: cls, section_id: sec })
      setResults(sheet.results)
      setTermName(sheet.exam_term_name)
    } catch (ex) { setErr(ex instanceof Error ? ex.message : 'Failed') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [term, cls, sec])

  const INP: preact.JSX.CSSProperties = { padding: '0.375rem 0.5rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.8rem' }
  const LBL: preact.JSX.CSSProperties = { fontSize: '0.7rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 2 }

  const allSubjects = results[0]?.subjects.map(s => s.subject_name) ?? []

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.625rem', marginBottom: '1rem' }}>
        <div>
          <label style={LBL}>Term</label>
          <select value={term} onChange={e => setTerm((e.target as HTMLSelectElement).value)} style={{ ...INP, width: '100%' }}>
            <option value="">— select —</option>
            {terms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label style={LBL}>Class</label>
          <select value={cls} onChange={e => { setCls((e.target as HTMLSelectElement).value); setSec('') }} style={{ ...INP, width: '100%' }}>
            <option value="">— select —</option>
            {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label style={LBL}>{getSectionLabel()}</label>
          <select value={sec} onChange={e => setSec((e.target as HTMLSelectElement).value)} style={{ ...INP, width: '100%' }} disabled={!cls}>
            <option value="">— select —</option>
            {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>

      {err && <p style={{ color: '#ef4444', fontSize: '0.8rem' }}>{err}</p>}
      {loading && <p style={{ color: '#6b7280', fontSize: '0.8rem' }}>Loading results…</p>}

      {results.length > 0 && (
        <>
          <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.5rem' }}>
            {termName} — {results.length} student{results.length !== 1 ? 's' : ''} ·{' '}
            Pass: {results.filter(r => r.passed).length} / {results.length}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.75rem' }}>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  <th style={{ border: '1px solid #e5e7eb', padding: '0.375rem 0.5rem', textAlign: 'left', color: '#6b7280', fontWeight: 600, width: 50 }}>Roll</th>
                  <th style={{ border: '1px solid #e5e7eb', padding: '0.375rem 0.5rem', textAlign: 'left', color: '#6b7280', fontWeight: 600, minWidth: 130 }}>Name</th>
                  {allSubjects.map(s => (
                    <th key={s} style={{ border: '1px solid #e5e7eb', padding: '0.375rem 0.5rem', textAlign: 'center', color: '#6b7280', fontWeight: 600, minWidth: 90 }}>{s}</th>
                  ))}
                  <th style={{ border: '1px solid #e5e7eb', padding: '0.375rem 0.5rem', textAlign: 'center', color: '#6b7280', fontWeight: 600, width: 70 }}>%</th>
                  <th style={{ border: '1px solid #e5e7eb', padding: '0.375rem 0.5rem', textAlign: 'center', color: '#6b7280', fontWeight: 600, width: 50 }}>Grade</th>
                  <th style={{ border: '1px solid #e5e7eb', padding: '0.375rem 0.5rem', textAlign: 'center', color: '#6b7280', fontWeight: 600, width: 55 }}>Result</th>
                  <th style={{ border: '1px solid #e5e7eb', padding: '0.375rem 0.5rem', textAlign: 'center', color: '#6b7280', fontWeight: 600, width: 70 }}>Card</th>
                </tr>
              </thead>
              <tbody>
                {results.map(r => (
                  <tr key={r.student_id} style={{ background: r.passed ? '#fff' : '#fef2f2' }}>
                    <td style={{ border: '1px solid #e5e7eb', padding: '0.3rem 0.5rem', color: '#6b7280' }}>{r.roll_number}</td>
                    <td style={{ border: '1px solid #e5e7eb', padding: '0.3rem 0.5rem', fontWeight: 500 }}>{r.student_name}</td>
                    {r.subjects.map(s => (
                      <td key={s.subject_id} style={{ border: '1px solid #e5e7eb', padding: '0.3rem 0.5rem', textAlign: 'center' }}>
                        {s.is_absent ? (
                          <span style={{ color: '#6b7280' }}>AB</span>
                        ) : (
                          <span style={{ color: s.passed ? '#111827' : '#dc2626' }}>
                            {s.marks_obtained ?? '—'}/{s.max_marks}
                          </span>
                        )}
                      </td>
                    ))}
                    <td style={{ border: '1px solid #e5e7eb', padding: '0.3rem 0.5rem', textAlign: 'center', fontWeight: 600 }}>
                      {r.percentage != null ? `${r.percentage}%` : '—'}
                    </td>
                    <td style={{ border: '1px solid #e5e7eb', padding: '0.3rem 0.5rem', textAlign: 'center', fontWeight: 700, color: GRADE_COLOR[r.grade] ?? '#111827' }}>
                      {r.grade}
                    </td>
                    <td style={{ border: '1px solid #e5e7eb', padding: '0.3rem 0.5rem', textAlign: 'center' }}>
                      <span style={{ padding: '1px 7px', borderRadius: 9999, fontSize: '0.7rem', fontWeight: 600, background: r.passed ? '#d1fae5' : '#fee2e2', color: r.passed ? '#0D332A' : '#dc2626' }}>
                        {r.passed ? 'PASS' : 'FAIL'}
                      </span>
                    </td>
                    <td style={{ border: '1px solid #e5e7eb', padding: '0.3rem 0.5rem', textAlign: 'center' }}>
                      <button
                        onClick={() => downloadReportCard(term, r.student_id, `${r.admission_no}-${termName}`).catch(() => alert('Could not download report card'))}
                        style={{ padding: '2px 8px', background: '#14463A', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.7rem', fontWeight: 600 }}
                      >PDF</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!loading && results.length === 0 && term && cls && sec && (
        <p style={{ color: '#9ca3af', fontSize: '0.8rem' }}>No marks entered yet for this term and class-section.</p>
      )}
      {!term && <p style={{ color: '#9ca3af', fontSize: '0.8rem' }}>Select a term, class, and section to view the result sheet.</p>}
    </div>
  )
}

// ── Main Exam View ─────────────────────────────────────────────────────────────

export function ExamView({ role }: { role?: string }) {
  const [tab, setTab] = useState<'terms' | 'subjects' | 'entry' | 'results'>('entry')
  const [years, setYears] = useState<AcademicYear[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [terms, setTerms] = useState<ExamTerm[]>([])
  const [subjects, setSubjects] = useState<ExamSubject[]>([])
  const [loading, setLoading] = useState(true)

  const canManage = role === 'principal' || role === 'vice_principal' || role === 'superadmin'

  useEffect(() => {
    const isTeacher = role === 'teacher' || role === 'class_teacher'
    const classLoader = isTeacher ? getAssignedClasses() as Promise<Class[]> : listClasses()
    Promise.all([listAcademicYears(), classLoader]).then(([ayList, clsList]) => {
      setYears(ayList)
      setClasses(clsList)
      const cur = ayList.find(y => y.is_current) ?? ayList[0]
      if (cur) {
        Promise.all([
          listTerms({ academic_year_id: cur.id }),
          listSubjects({ academic_year_id: cur.id }),
        ]).then(([t, s]) => { setTerms(t); setSubjects(s) })
      }
      setLoading(false)
    })
  }, [])

  const currentYear = years.find(y => y.is_current) ?? years[0] ?? null

  function handleTermUpdate(updated: ExamTerm) {
    setTerms(prev => prev.map(t => t.id === updated.id ? updated : t))
  }

  function handleTermAdd(created: ExamTerm) {
    setTerms(prev => [...prev, created])
  }

  function handleSubjectAdd(created: ExamSubject) {
    setSubjects(prev => [...prev, created])
  }

  function handleSubjectRemove(id: string) {
    setSubjects(prev => prev.filter(s => s.id !== id))
  }

  const TAB_BTN = (active: boolean): preact.JSX.CSSProperties => ({
    padding: '0.4rem 1rem', border: 'none', borderBottom: active ? '2px solid #14463A' : '2px solid transparent',
    background: 'none', cursor: 'pointer', fontSize: '0.875rem', fontWeight: active ? 600 : 400,
    color: active ? '#14463A' : '#6b7280',
  })

  if (loading) return <div style={{ padding: '2rem', color: '#6b7280', fontSize: '0.875rem' }}>Loading…</div>

  return (
    <div style={{ maxWidth: 1000, margin: '1.5rem auto', padding: '0 1rem' }}>
      <h2 style={{ margin: '0 0 0.75rem', fontSize: '1.1rem', fontWeight: 700, color: '#111827' }}>Examinations</h2>
      <div style={{ borderBottom: '1px solid #e5e7eb', marginBottom: '1.25rem', display: 'flex', gap: '0.25rem' }}>
        {canManage && <button style={TAB_BTN(tab === 'terms')} onClick={() => setTab('terms')}>Manage Terms</button>}
        {canManage && <button style={TAB_BTN(tab === 'subjects')} onClick={() => setTab('subjects')}>Manage Subjects</button>}
        <button style={TAB_BTN(tab === 'entry')} onClick={() => setTab('entry')}>Marks Entry</button>
        <button style={TAB_BTN(tab === 'results')} onClick={() => setTab('results')}>Results</button>
      </div>
      {tab === 'terms' && canManage && <TermsTab terms={terms} onUpdate={handleTermUpdate} onAdd={handleTermAdd} canManage={canManage} academicYearId={currentYear?.id ?? null} />}
      {tab === 'subjects' && canManage && <SubjectsTab subjects={subjects} classes={classes} academicYearId={currentYear?.id ?? null} onAdd={handleSubjectAdd} onRemove={handleSubjectRemove} />}
      {tab === 'entry' && <MarksEntryTab terms={terms} subjects={subjects} classes={classes} role={role} />}
      {tab === 'results' && <ResultsTab terms={terms} classes={classes} />}
    </div>
  )
}
