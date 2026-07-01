import { useEffect, useMemo, useState } from 'preact/hooks'
import { assignClass, listAssignments, listStaff, removeAssignment } from '../api/staff'
import { listAcademicYears, listClasses } from '../api/students'
import { getSectionLabel } from '../api/auth_state'
import {
  createRun, downloadPayslipPdf, finalizeRun, getRunPayslips, getSalary,
  listRuns, listStaffPayslips, setSalary, updatePayslip,
} from '../api/payroll'
import { useIsMobile } from '../hooks/useIsMobile'
import type { Assignment, Staff } from '../types/staff'
import type { AcademicYear, Class, Section } from '../types/student'
import type { Payslip, PayrollRun, SalaryComponent, StaffPayslipSummary } from '../types/payroll'

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']
const inr = (n: string | number) => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })
const sumLines = (lines: { amount: string }[]) => lines.reduce((s, l) => s + Number(l.amount || 0), 0)

const INP: preact.JSX.CSSProperties = { padding: '0.4rem 0.6rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.82rem' }
const BTN = (primary: boolean): preact.JSX.CSSProperties => ({
  padding: '0.45rem 0.9rem', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600,
  background: primary ? '#14463A' : '#f3f4f6', color: primary ? '#fff' : '#374151',
})

// ── Salary structure + assignments + payslips for one staff member ────────────
function StaffDrawer({ staff, years, classes, onClose }: {
  staff: Staff; years: AcademicYear[]; classes: Class[]; onClose: () => void
}) {
  const [gross, setGross] = useState('')
  const [comps, setComps] = useState<SalaryComponent[]>([])
  const [savingSalary, setSavingSalary] = useState(false)
  const [salaryMsg, setSalaryMsg] = useState('')
  const [loaded, setLoaded] = useState(false)

  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [payslips, setPayslips] = useState<StaffPayslipSummary[]>([])
  const [err, setErr] = useState('')

  // Assignment form
  const [yearId, setYearId] = useState(years.find(y => y.is_current)?.id ?? years[0]?.id ?? '')
  const [classId, setClassId] = useState('')
  const [sectionId, setSectionId] = useState('')
  const [subject, setSubject] = useState('')
  const [isCT, setIsCT] = useState(false)
  const [savingAssign, setSavingAssign] = useState(false)
  const sections: Section[] = classes.find(c => c.id === classId)?.sections ?? []

  useEffect(() => {
    getSalary(staff.id).then(s => {
      if (s) { setGross(String(s.gross_salary)); setComps(s.components) }
      setLoaded(true)
    }).catch(() => setLoaded(true))
    listAssignments(staff.id).then(setAssignments).catch(() => {})
    listStaffPayslips(staff.id).then(setPayslips).catch(() => {})
  }, [staff.id])

  function setComp(i: number, patch: Partial<SalaryComponent>) {
    setComps(cs => cs.map((c, idx) => idx === i ? { ...c, ...patch } : c))
  }

  const net = useMemo(() => {
    const add = comps.filter(c => c.type === 'allowance').reduce((s, c) => s + Number(c.amount || 0), 0)
    const sub = comps.filter(c => c.type === 'deduction').reduce((s, c) => s + Number(c.amount || 0), 0)
    return Number(gross || 0) + add - sub
  }, [gross, comps])

  async function saveSalary() {
    setSavingSalary(true); setSalaryMsg(''); setErr('')
    try {
      await setSalary(staff.id, {
        gross_salary: Number(gross || 0),
        components: comps.filter(c => c.name.trim()).map(c => ({ ...c, amount: String(c.amount || 0) })),
      })
      setSalaryMsg('Saved')
      setTimeout(() => setSalaryMsg(''), 2000)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save salary') }
    finally { setSavingSalary(false) }
  }

  async function addAssignment() {
    if (!yearId || !classId || !sectionId) return
    setSavingAssign(true); setErr('')
    try {
      await assignClass(staff.id, {
        academic_year_id: yearId, class_id: classId, section_id: sectionId,
        subject: subject.trim() || undefined, is_class_teacher: isCT,
      })
      setAssignments(await listAssignments(staff.id))
      setSubject(''); setIsCT(false)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not assign') }
    finally { setSavingAssign(false) }
  }

  async function dropAssignment(id: string) {
    setErr('')
    try { await removeAssignment(staff.id, id); setAssignments(a => a.filter(x => x.id !== id)) }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not remove') }
  }

  const H4: preact.JSX.CSSProperties = { margin: '0 0 0.6rem', fontSize: '0.9rem', fontWeight: 700, color: '#14463A' }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(13,51,42,.45)', display: 'flex', justifyContent: 'flex-end', zIndex: 200 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(560px, 100%)', height: '100%', background: '#fff', overflowY: 'auto', padding: '1.25rem', boxShadow: '-4px 0 24px rgba(0,0,0,.12)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{staff.first_name} {staff.last_name}</h3>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: '#6b7280' }}>
              {staff.employee_no} · {staff.designation}{staff.department ? ` · ${staff.department}` : ''}
            </p>
          </div>
          <button onClick={onClose} style={{ ...BTN(false), padding: '0.3rem 0.7rem' }}>Close</button>
        </div>

        {err && <p style={{ color: '#c00', fontSize: '0.8rem', marginBottom: '0.75rem' }}>{err}</p>}

        {/* ── Salary structure ── */}
        <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '1rem', marginBottom: '1.25rem' }}>
          <h4 style={H4}>Salary</h4>
          {!loaded ? <p style={{ fontSize: '0.8rem', color: '#9ca3af' }}>Loading…</p> : (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', marginBottom: '0.75rem' }}>
                <span style={{ width: 130, color: '#374151', fontWeight: 600 }}>Gross monthly (₹)</span>
                <input type="number" min="0" step="0.01" value={gross} onInput={e => setGross((e.target as HTMLInputElement).value)} style={{ ...INP, flex: 1 }} placeholder="0.00" />
              </label>

              <div style={{ fontSize: '0.74rem', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em', margin: '0.5rem 0 0.4rem' }}>
                Recurring allowances / deductions
              </div>
              {comps.map((c, i) => (
                <div key={i} style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem', alignItems: 'center' }}>
                  <input value={c.name} onInput={e => setComp(i, { name: (e.target as HTMLInputElement).value })} placeholder="e.g. HRA, PF, Advance" style={{ ...INP, flex: 1 }} />
                  <select value={c.type} onChange={e => setComp(i, { type: (e.target as HTMLSelectElement).value as 'allowance' | 'deduction' })} style={INP}>
                    <option value="allowance">+ Allowance</option>
                    <option value="deduction">− Deduction</option>
                  </select>
                  <input type="number" min="0" step="0.01" value={c.amount} onInput={e => setComp(i, { amount: (e.target as HTMLInputElement).value })} placeholder="0.00" style={{ ...INP, width: 90 }} />
                  <button onClick={() => setComps(cs => cs.filter((_, idx) => idx !== i))} style={{ ...BTN(false), padding: '0.35rem 0.55rem' }}>✕</button>
                </div>
              ))}
              <button onClick={() => setComps(cs => [...cs, { name: '', type: 'allowance', amount: '' }])} style={{ ...BTN(false), marginTop: '0.25rem' }}>+ Add line</button>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.9rem', paddingTop: '0.75rem', borderTop: '1px solid #e5e7eb' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>Net monthly: <span style={{ color: '#14463A' }}>{inr(net)}</span></span>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  {salaryMsg && <span style={{ fontSize: '0.78rem', color: '#1F8A5D', fontWeight: 600 }}>✓ {salaryMsg}</span>}
                  <button onClick={saveSalary} disabled={savingSalary} style={BTN(true)}>{savingSalary ? 'Saving…' : 'Save salary'}</button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── Class assignments ── */}
        <div style={{ marginBottom: '1.25rem' }}>
          <h4 style={H4}>Class assignments</h4>
          {assignments.length === 0 && <p style={{ fontSize: '0.8rem', color: '#9ca3af', margin: '0 0 0.5rem' }}>No classes assigned yet.</p>}
          {assignments.map(a => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0', borderBottom: '1px solid #f3f4f6', fontSize: '0.8rem' }}>
              <span style={{ flex: 1 }}>
                {a.class_name} {a.section_name}{a.subject ? ` · ${a.subject}` : ''}
                {a.is_class_teacher && <span style={{ marginLeft: 6, padding: '1px 6px', background: '#d1fae5', color: '#0D332A', borderRadius: 9999, fontSize: '0.66rem', fontWeight: 700 }}>Class teacher</span>}
              </span>
              <span style={{ color: '#9ca3af', fontSize: '0.72rem' }}>{a.academic_year_name}</span>
              <button onClick={() => dropAssignment(a.id)} style={{ ...BTN(false), padding: '0.25rem 0.5rem' }}>Remove</button>
            </div>
          ))}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.6rem', alignItems: 'center' }}>
            <select value={yearId} onChange={e => setYearId((e.target as HTMLSelectElement).value)} style={INP}>
              {years.map(y => <option key={y.id} value={y.id}>{y.name}{y.is_current ? ' ★' : ''}</option>)}
            </select>
            <select value={classId} onChange={e => { setClassId((e.target as HTMLSelectElement).value); setSectionId('') }} style={INP}>
              <option value="">Class</option>
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={sectionId} onChange={e => setSectionId((e.target as HTMLSelectElement).value)} style={INP} disabled={!classId}>
              <option value="">{getSectionLabel()}</option>
              {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input value={subject} onInput={e => setSubject((e.target as HTMLInputElement).value)} placeholder="Subject (optional)" style={{ ...INP, width: 130 }} />
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem' }}>
              <input type="checkbox" checked={isCT} onChange={e => setIsCT((e.target as HTMLInputElement).checked)} /> Class teacher
            </label>
            <button onClick={addAssignment} disabled={savingAssign || !classId || !sectionId} style={BTN(true)}>{savingAssign ? '…' : 'Assign'}</button>
          </div>
        </div>

        {/* ── Recent payslips ── */}
        <div>
          <h4 style={H4}>Recent payslips</h4>
          {payslips.length === 0 ? <p style={{ fontSize: '0.8rem', color: '#9ca3af', margin: 0 }}>No payslips yet — generate a payroll run.</p> : (
            payslips.map(p => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0', borderBottom: '1px solid #f3f4f6', fontSize: '0.8rem' }}>
                <span style={{ flex: 1 }}>{MONTHS[p.period_month]} {p.period_year}</span>
                <span style={{ color: p.status === 'finalized' ? '#1F8A5D' : '#92400e', fontSize: '0.7rem', fontWeight: 600 }}>{p.status}</span>
                <span style={{ fontWeight: 700, color: '#14463A', width: 90, textAlign: 'right' }}>{inr(p.net_salary)}</span>
                <button onClick={() => downloadPayslipPdf(p.id, `${staff.employee_no}-${p.period_year}-${String(p.period_month).padStart(2, '0')}`).catch(() => {})} style={{ ...BTN(false), padding: '0.25rem 0.55rem' }}>PDF</button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ── Salary tab: staff list → tap → drawer ─────────────────────────────────────
function SalaryTab({ years, classes }: { years: AcademicYear[]; classes: Class[] }) {
  const [staff, setStaff] = useState<Staff[]>([])
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<Staff | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { listStaff({ limit: 500 }).then(r => setStaff(r.items)).finally(() => setLoading(false)) }, [])

  const visible = filter
    ? staff.filter(s => `${s.first_name} ${s.last_name} ${s.designation} ${s.employee_no}`.toLowerCase().includes(filter.toLowerCase()))
    : staff

  return (
    <div>
      <input value={filter} onInput={e => setFilter((e.target as HTMLInputElement).value)} placeholder="Search staff by name, designation…" style={{ ...INP, width: '100%', maxWidth: 340, marginBottom: '0.875rem' }} />
      {loading ? <p style={{ color: '#9ca3af', fontSize: '0.85rem' }}>Loading…</p> : (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ display: 'flex', padding: '0 1rem', height: 36, background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontSize: '0.74rem', fontWeight: 600, color: '#6b7280', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ width: 80 }}>EMP NO</span>
            <span style={{ flex: 1 }}>NAME</span>
            <span style={{ width: 150 }}>DESIGNATION</span>
            <span style={{ width: 90, textAlign: 'right' }}></span>
          </div>
          {visible.length === 0 && <p style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af', fontSize: '0.85rem' }}>No staff found.</p>}
          {visible.map(s => (
            <div key={s.id} onClick={() => setSelected(s)} style={{ display: 'flex', padding: '0.5rem 1rem', borderBottom: '1px solid #f3f4f6', gap: '0.75rem', fontSize: '0.8rem', alignItems: 'center', cursor: 'pointer' }}>
              <span style={{ width: 80, fontWeight: 700, color: '#14463A' }}>{s.employee_no}</span>
              <span style={{ flex: 1, fontWeight: 500 }}>{s.first_name} {s.last_name}</span>
              <span style={{ width: 150, color: '#6b7280' }}>{s.designation}</span>
              <span style={{ width: 90, textAlign: 'right', color: '#1F8A5D', fontWeight: 600 }}>Manage →</span>
            </div>
          ))}
        </div>
      )}
      {selected && <StaffDrawer staff={selected} years={years} classes={classes} onClose={() => setSelected(null)} />}
    </div>
  )
}

// ── Payslip inline editor ──────────────────────────────────────────────────────
function PayslipRow({ slip, locked, onSaved }: { slip: Payslip; locked: boolean; onSaved: (p: Payslip) => void }) {
  const [open, setOpen] = useState(false)
  const [allow, setAllow] = useState(slip.allowances)
  const [deduct, setDeduct] = useState(slip.deductions)
  const [note, setNote] = useState(slip.note ?? '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    setSaving(true); setErr('')
    try {
      const updated = await updatePayslip(slip.id, {
        allowances: allow.filter(l => l.name.trim()).map(l => ({ name: l.name, amount: Number(l.amount || 0) })),
        deductions: deduct.filter(l => l.name.trim()).map(l => ({ name: l.name, amount: Number(l.amount || 0) })),
        note: note.trim() || undefined,
      })
      onSaved(updated); setOpen(false)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save') }
    finally { setSaving(false) }
  }

  const fname = `${slip.employee_no}-${slip.run_id.slice(0, 6)}`
  const lineEditor = (lines: typeof allow, set: (v: typeof allow) => void, label: string) => (
    <div style={{ flex: 1, minWidth: 220 }}>
      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#6b7280', marginBottom: '0.3rem' }}>{label}</div>
      {lines.map((l, i) => (
        <div key={i} style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.3rem' }}>
          <input value={l.name} onInput={e => set(lines.map((x, idx) => idx === i ? { ...x, name: (e.target as HTMLInputElement).value } : x))} placeholder="Name" style={{ ...INP, flex: 1 }} />
          <input type="number" min="0" step="0.01" value={l.amount} onInput={e => set(lines.map((x, idx) => idx === i ? { ...x, amount: (e.target as HTMLInputElement).value } : x))} placeholder="0.00" style={{ ...INP, width: 80 }} />
          <button onClick={() => set(lines.filter((_, idx) => idx !== i))} style={{ ...BTN(false), padding: '0.25rem 0.5rem' }}>✕</button>
        </div>
      ))}
      <button onClick={() => set([...lines, { name: '', amount: '' }])} style={{ ...BTN(false), padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}>+ Add</button>
    </div>
  )

  return (
    <div style={{ borderBottom: '1px solid #f3f4f6' }}>
      <div style={{ display: 'flex', padding: '0.5rem 1rem', gap: '0.75rem', fontSize: '0.8rem', alignItems: 'center' }}>
        <span style={{ width: 80, fontWeight: 700, color: '#14463A' }}>{slip.employee_no}</span>
        <span style={{ flex: 1, fontWeight: 500 }}>{slip.staff_name}</span>
        <span style={{ width: 90, textAlign: 'right', color: '#6b7280' }}>{inr(slip.gross_salary)}</span>
        <span style={{ width: 80, textAlign: 'right', color: '#1F8A5D' }}>+{inr(sumLines(slip.allowances))}</span>
        <span style={{ width: 80, textAlign: 'right', color: '#dc2626' }}>−{inr(sumLines(slip.deductions))}</span>
        <span style={{ width: 95, textAlign: 'right', fontWeight: 700 }}>{inr(slip.net_salary)}</span>
        <span style={{ display: 'flex', gap: '0.35rem' }}>
          {!locked && <button onClick={() => setOpen(o => !o)} style={{ ...BTN(false), padding: '0.25rem 0.55rem' }}>{open ? 'Cancel' : 'Edit'}</button>}
          <button onClick={() => downloadPayslipPdf(slip.id, fname).catch(() => {})} style={{ ...BTN(false), padding: '0.25rem 0.55rem' }}>PDF</button>
        </span>
      </div>
      {open && !locked && (
        <div style={{ padding: '0.5rem 1rem 1rem', background: '#f9fafb' }}>
          {err && <p style={{ color: '#c00', fontSize: '0.78rem' }}>{err}</p>}
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
            {lineEditor(allow, setAllow, 'Allowances')}
            {lineEditor(deduct, setDeduct, 'Deductions')}
          </div>
          <input value={note} onInput={e => setNote((e.target as HTMLInputElement).value)} placeholder="Note (optional)" style={{ ...INP, width: '100%', marginBottom: '0.5rem' }} />
          <button onClick={save} disabled={saving} style={BTN(true)}>{saving ? 'Saving…' : 'Save payslip'}</button>
        </div>
      )}
    </div>
  )
}

// ── Runs tab ───────────────────────────────────────────────────────────────────
function RunsTab() {
  const now = new Date()
  const [runs, setRuns] = useState<PayrollRun[]>([])
  const [sel, setSel] = useState<PayrollRun | null>(null)
  const [slips, setSlips] = useState<Payslip[]>([])
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function loadRuns() { setRuns(await listRuns()) }
  useEffect(() => { loadRuns().catch(e => setErr(e instanceof Error ? e.message : 'Failed')) }, [])

  async function openRun(r: PayrollRun) {
    setSel(r); setSlips([])
    try { setSlips(await getRunPayslips(r.id)) } catch (e) { setErr(e instanceof Error ? e.message : 'Failed') }
  }

  async function newRun() {
    setBusy(true); setErr('')
    try {
      const r = await createRun(month, year)
      await loadRuns(); await openRun(r)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not create run') }
    finally { setBusy(false) }
  }

  async function finalize() {
    if (!sel || !confirm('Finalize this payroll run? Payslips can no longer be edited.')) return
    setBusy(true); setErr('')
    try {
      const r = await finalizeRun(sel.id)
      setSel(r); await loadRuns()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not finalize') }
    finally { setBusy(false) }
  }

  const locked = sel?.status === 'finalized'
  const totalNet = slips.reduce((s, p) => s + Number(p.net_salary), 0)

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <select value={month} onChange={e => setMonth(Number((e.target as HTMLSelectElement).value))} style={INP}>
          {MONTHS.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
        </select>
        <input type="number" min="2020" max="2100" value={year} onInput={e => setYear(Number((e.target as HTMLInputElement).value))} style={{ ...INP, width: 90 }} />
        <button onClick={newRun} disabled={busy} style={BTN(true)}>{busy ? 'Working…' : 'Generate payroll run'}</button>
      </div>
      {err && <p style={{ color: '#c00', fontSize: '0.8rem', marginBottom: '0.5rem' }}>{err}</p>}

      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {runs.map(r => (
          <button key={r.id} onClick={() => openRun(r)} style={{
            ...BTN(sel?.id === r.id), background: sel?.id === r.id ? '#14463A' : (r.status === 'finalized' ? '#d1fae5' : '#fef3c7'),
            color: sel?.id === r.id ? '#fff' : '#374151',
          }}>
            {MONTHS[r.period_month]} {r.period_year} · {r.payslip_count} · {inr(r.total_net)}
          </button>
        ))}
        {runs.length === 0 && <span style={{ fontSize: '0.82rem', color: '#9ca3af' }}>No payroll runs yet. Pick a month and generate one.</span>}
      </div>

      {sel && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 1rem', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
            <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>
              {MONTHS[sel.period_month]} {sel.period_year}
              <span style={{ marginLeft: 8, padding: '1px 8px', borderRadius: 9999, fontSize: '0.7rem', fontWeight: 600, background: locked ? '#d1fae5' : '#fef3c7', color: locked ? '#0D332A' : '#92400e' }}>{sel.status}</span>
            </span>
            {!locked && <button onClick={finalize} disabled={busy} style={BTN(true)}>Finalize run</button>}
          </div>
          <div style={{ display: 'flex', padding: '0 1rem', height: 32, background: '#fcfcfc', borderBottom: '1px solid #f3f4f6', fontSize: '0.7rem', fontWeight: 600, color: '#9ca3af', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ width: 80 }}>EMP NO</span><span style={{ flex: 1 }}>NAME</span>
            <span style={{ width: 90, textAlign: 'right' }}>GROSS</span>
            <span style={{ width: 80, textAlign: 'right' }}>ALLOW</span>
            <span style={{ width: 80, textAlign: 'right' }}>DEDUCT</span>
            <span style={{ width: 95, textAlign: 'right' }}>NET</span>
            <span style={{ width: 96 }}></span>
          </div>
          {slips.map(p => (
            <PayslipRow key={p.id} slip={p} locked={locked} onSaved={u => setSlips(s => s.map(x => x.id === u.id ? u : x))} />
          ))}
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0.6rem 1rem', fontWeight: 700, fontSize: '0.85rem' }}>
            Total net payout: <span style={{ color: '#14463A', marginLeft: 8 }}>{inr(totalNet)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main ────────────────────────────────────────────────────────────────────--
export function PayrollView() {
  const isMobile = useIsMobile()
  const [tab, setTab] = useState<'salary' | 'runs'>('salary')
  const [years, setYears] = useState<AcademicYear[]>([])
  const [classes, setClasses] = useState<Class[]>([])

  useEffect(() => {
    Promise.all([listAcademicYears(), listClasses()]).then(([ys, cs]) => { setYears(ys); setClasses(cs) }).catch(() => {})
  }, [])

  const TAB = (active: boolean): preact.JSX.CSSProperties => ({
    padding: '0.4rem 0.9rem', border: 'none', borderBottom: active ? '2px solid #14463A' : '2px solid transparent',
    background: 'none', color: active ? '#14463A' : '#6b7280', cursor: 'pointer', fontSize: '0.875rem', fontWeight: active ? 600 : 400,
  })

  return (
    <div style={{ padding: isMobile ? '1rem 0.75rem' : '1.5rem', fontFamily: 'system-ui, sans-serif' }}>
      <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.25rem', fontWeight: 700 }}>Payroll</h2>
      <p style={{ margin: '0 0 1rem', fontSize: '0.8rem', color: '#6b7280' }}>Set staff salaries and assignments, then generate monthly payslips.</p>
      <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '1px solid #e5e7eb', marginBottom: '1.25rem' }}>
        <button onClick={() => setTab('salary')} style={TAB(tab === 'salary')}>Staff &amp; Salary</button>
        <button onClick={() => setTab('runs')} style={TAB(tab === 'runs')}>Monthly Payroll</button>
      </div>
      {tab === 'salary' ? <SalaryTab years={years} classes={classes} /> : <RunsTab />}
    </div>
  )
}
