import { useEffect, useState } from 'preact/hooks'
import {
  listSubjects, listTerms, listMarksConfig, getMarks, saveMarks, getTermResults,
  listComponents, configureComponents, getComponentGrid, saveComponentMarks,
} from '../api/exam'
import { listAcademicYears, listClasses, listStudents } from '../api/students'
import type {
  ExamSubject, ExamTerm, MarksConfig, StudentTermResult, MarkEntry,
  ExamComponent, StudentComponentRow,
} from '../api/exam'
import type { AcademicYear, Class, Section } from '../types/student'

const GRADE_COLOR: Record<string, string> = {
  A1: '#0D332A', A2: '#0D332A', B1: '#0D332A', B2: '#0D332A',
  C1: '#92400e', C2: '#92400e', D: '#7c3aed', E: '#dc2626', AB: '#6b7280',
}

// ── Tab: Marks Entry ──────────────────────────────────────────────────────────

interface PendingEntry { student_id: string; student_name: string; roll_number: string; marks: string; absent: boolean }
interface CompDef { name: string; max_marks: string }

const DEFAULT_DEFS: CompDef[] = [
  { name: 'Unit Test', max_marks: '10' },
  { name: 'Oral', max_marks: '10' },
  { name: 'Theory', max_marks: '80' },
]

function MarksEntryTab({
  terms, subjects, classes,
}: {
  terms: ExamTerm[]
  subjects: ExamSubject[]
  classes: Class[]
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
        setDefs(comps.map(c => ({ name: c.name, max_marks: c.max_marks })))
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
      .map((d, i) => ({ name: d.name.trim(), max_marks: +d.max_marks, sort_order: i + 1 }))
    if (parsed.length === 0) { setErr('Add at least one component'); return }
    try {
      await configureComponents({ exam_term_id: term, exam_subject_id: subject, components: parsed })
      await loadAll()
    } catch (ex) { setErr(ex instanceof Error ? ex.message : 'Failed to save components') }
  }

  async function handleSaveFlat() {
    setSaving(true); setSaved(false); setErr('')
    try {
      const entries = rows.map(r => ({
        student_id: r.student_id, exam_subject_id: subject,
        marks_obtained: r.absent ? null : (r.marks === '' ? null : +r.marks), is_absent: r.absent,
      }))
      await saveMarks({ exam_term_id: term, entries })
      setSaved(true); setTimeout(() => setSaved(false), 2500)
    } catch (ex) { setErr(ex instanceof Error ? ex.message : 'Save failed') }
    finally { setSaving(false) }
  }

  async function handleSaveComponents() {
    setSaving(true); setSaved(false); setErr('')
    try {
      const entries = grid.flatMap(r =>
        components.map(c => ({
          student_id: r.student_id, exam_component_id: c.id,
          marks_obtained: r.is_absent ? null : (r.marks[c.id] ?? null), is_absent: r.is_absent,
        }))
      )
      await saveComponentMarks({ exam_term_id: term, exam_subject_id: subject, entries })
      setSaved(true); setTimeout(() => setSaved(false), 2500)
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
      const total = components.reduce((s, c) => s + (marks[c.id] ?? 0), 0)
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

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.625rem', marginBottom: '1rem' }}>
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
          <label style={LBL}>Section</label>
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
              <span>Components: <strong>{components.map(c => `${c.name} (${+c.max_marks})`).join(' + ')}</strong> = <strong>{totalMax}</strong></span>
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
                Define how this subject is assessed this term. Components sum to the subject total (e.g. Unit Test 10 + Oral 10 + Theory 80 = 100).
              </p>
              {defs.map((d, i) => (
                <div key={i} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.4rem', alignItems: 'center' }}>
                  <input value={d.name} placeholder="Component name"
                    onInput={e => setDefs(p => p.map((x, j) => j === i ? { ...x, name: (e.target as HTMLInputElement).value } : x))}
                    style={{ ...INP, flex: 1 }} />
                  <input type="number" min={1} value={d.max_marks} placeholder="Max"
                    onInput={e => setDefs(p => p.map((x, j) => j === i ? { ...x, max_marks: (e.target as HTMLInputElement).value } : x))}
                    style={{ ...INP, width: 70 }} />
                  <button onClick={() => setDefs(p => p.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '1rem' }}>×</button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.5rem' }}>
                <button onClick={() => setDefs(p => [...p, { name: '', max_marks: '' }])} style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: 4, padding: '0.3rem 0.625rem', fontSize: '0.75rem', cursor: 'pointer' }}>+ Add component</button>
                <span style={{ fontSize: '0.74rem', color: '#6b7280' }}>Total: <strong>{defs.reduce((s, d) => s + (+d.max_marks || 0), 0)}</strong></span>
                <button onClick={saveComponentDefs} style={{ marginLeft: 'auto', background: '#14463A', color: '#fff', border: 'none', borderRadius: 4, padding: '0.4rem 1rem', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>Save components</button>
              </div>
            </div>
          )}
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
                  <th style={{ ...TH, width: 80 }}>Total<br /><span style={{ fontWeight: 400, color: '#9ca3af' }}>/{totalMax}</span></th>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button onClick={handleSaveComponents} disabled={saving} style={{ padding: '0.5rem 1.25rem', background: '#14463A', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem' }}>
              {saving ? 'Saving…' : 'Save Marks'}
            </button>
            {saved && <span style={{ color: '#1F8A5D', fontSize: '0.8rem', fontWeight: 600 }}>✓ Saved</span>}
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
                    <input type="checkbox" checked={r.absent} onChange={e => updateRow(i, { absent: (e.target as HTMLInputElement).checked, marks: '' })} />
                  </td>
                  <td style={TD}>
                    <input type="number" min={0} max={selectedConfig ? +selectedConfig.max_marks : undefined} step={0.5}
                      value={r.marks} disabled={r.absent}
                      onInput={e => updateRow(i, { marks: (e.target as HTMLInputElement).value })}
                      style={{ ...cellInput, width: 70 }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button onClick={handleSaveFlat} disabled={saving} style={{ padding: '0.5rem 1.25rem', background: '#14463A', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem' }}>
              {saving ? 'Saving…' : 'Save Marks'}
            </button>
            {saved && <span style={{ color: '#1F8A5D', fontSize: '0.8rem', fontWeight: 600 }}>✓ Saved</span>}
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
          <label style={LBL}>Section</label>
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

export function ExamView() {
  const [tab, setTab] = useState<'entry' | 'results'>('entry')
  const [years, setYears] = useState<AcademicYear[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [terms, setTerms] = useState<ExamTerm[]>([])
  const [subjects, setSubjects] = useState<ExamSubject[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([listAcademicYears(), listClasses()]).then(([ayList, clsList]) => {
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
        <button style={TAB_BTN(tab === 'entry')} onClick={() => setTab('entry')}>Marks Entry</button>
        <button style={TAB_BTN(tab === 'results')} onClick={() => setTab('results')}>Results</button>
      </div>
      {tab === 'entry' && <MarksEntryTab terms={terms} subjects={subjects} classes={classes} />}
      {tab === 'results' && <ResultsTab terms={terms} classes={classes} />}
    </div>
  )
}
