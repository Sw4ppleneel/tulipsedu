import { useEffect, useState } from 'preact/hooks'
import {
  collectOffline, getDefaulters, getOutstanding, getPaymentLogs, getStudentLedger,
  listFeeHeads, listSchedules, sendReminders,
} from '../api/finance'
import type { Defaulter } from '../api/finance'
import { listAcademicYears, listClasses } from '../api/students'
import { useIsMobile } from '../hooks/useIsMobile'
import type { AcademicYear, Class } from '../types/student'
import type { FeeHead, FeeSchedule, OutstandingStudent } from '../types/finance'

type Tab = 'structure' | 'outstanding' | 'defaulters' | 'logs' | 'collect'

// Dense fee tables keep all columns; on a phone they scroll sideways inside this
// wrapper instead of crushing the layout. minWidth holds the columns legible.
function ScrollX({ minWidth, children }: { minWidth: number; children: preact.ComponentChildren }) {
  return (
    <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <div style={{ minWidth }}>{children}</div>
    </div>
  )
}

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmt(amount: string | number) {
  return `₹${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
}

function periodLabel(month: number | null, year: number) {
  if (!month) return `Annual ${year}`
  return `${MONTH_NAMES[month - 1]} ${year}`
}

// ── Fee Structure Tab (Excel-only setup + read-only view) ─────────────────────
function StructureTab({ years }: { years: AcademicYear[] }) {
  const isMobile = useIsMobile()
  const [heads, setHeads] = useState<FeeHead[]>([])
  const [schedules, setSchedules] = useState<FeeSchedule[]>([])
  const [yearId, setYearId] = useState(years.find((y) => y.is_current)?.id ?? '')
  const [error, setError] = useState('')
  const [xlsxFile, setXlsxFile] = useState<File | null>(null)
  const [result, setResult] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { listFeeHeads().then(setHeads).catch(() => {}) }, [])
  useEffect(() => {
    if (yearId) listSchedules(yearId).then(setSchedules).catch(() => {})
    else setSchedules([])
  }, [yearId])

  async function upload() {
    if (!xlsxFile || !yearId) return
    setBusy(true); setError(''); setResult('')
    try {
      const fd = new FormData()
      fd.append('file', xlsxFile)
      const { getAuthState } = await import('../api/auth_state')
      const auth = getAuthState()
      const res = await fetch(`/api/v1/fees/import-excel?academic_year_id=${yearId}`, {
        method: 'POST',
        headers: auth ? { Authorization: `Bearer ${auth.accessToken}`, 'X-Tenant-Slug': auth.tenantSlug } : {},
        body: fd,
      })
      const data = await res.json()
      if (!res.ok) { setError(data.detail || 'Import failed'); return }
      setResult(
        `✓ ${data.fee_heads_created} fee head(s) + ${data.schedules_created} schedule(s) saved · ` +
        `${data.ledger_entries_created} fee entries applied to ${data.students_affected} student(s)`
      )
      setXlsxFile(null)
      listFeeHeads().then(setHeads)
      listSchedules(yearId).then(setSchedules)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  const INP: preact.JSX.CSSProperties = { padding: '0.375rem 0.625rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.8rem' }

  return (
    <div>
      {error && <p style={{ color: '#c00', fontSize: '0.8rem', marginBottom: '0.75rem' }}>{error}</p>}

      {/* Upload panel — the only way to set up fees */}
      <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '1rem', marginBottom: '1.25rem' }}>
        <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem' }}>Upload Fee Structure</h4>
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.78rem', color: '#6b7280' }}>
          Excel columns: <b>Fee Head</b> · <b>Fee Type</b> (monthly / annual / one_time) · <b>Class</b> (name or <b>ALL</b>) · <b>Amount</b>.
          Uploading sets up the fee structure <b>and applies it to every student</b> for the selected year.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={yearId} onChange={(e) => setYearId((e.target as HTMLSelectElement).value)} style={INP}>
            <option value="">Select academic year</option>
            {years.map((y) => <option key={y.id} value={y.id}>{y.name}{y.is_current ? ' ★' : ''}</option>)}
          </select>
          <input type="file" accept=".xlsx" onChange={(e) => setXlsxFile((e.target as HTMLInputElement).files?.[0] ?? null)} style={{ fontSize: '0.8rem' }} />
          <button
            onClick={upload}
            disabled={!xlsxFile || !yearId || busy}
            style={{ padding: '0.375rem 0.875rem', background: (!xlsxFile || !yearId || busy) ? '#9ca3af' : '#1F8A5D', color: '#fff', border: 'none', borderRadius: 4, cursor: (!xlsxFile || !yearId || busy) ? 'default' : 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
          >
            {busy ? 'Applying…' : 'Upload & Apply'}
          </button>
        </div>
        {result && <p style={{ margin: '0.75rem 0 0', fontSize: '0.78rem', color: '#1F8A5D', fontWeight: 600 }}>{result}</p>}
      </div>

      {/* Read-only view of what is configured */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1.5rem' }}>
        <div>
          <h4 style={{ margin: '0 0 0.625rem', fontSize: '0.9rem' }}>Fee Heads</h4>
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden' }}>
            {heads.length === 0 && <p style={{ padding: '0.875rem', fontSize: '0.8rem', color: '#9ca3af' }}>No fee heads yet — upload a structure sheet.</p>}
            {heads.map((h) => (
              <div key={h.id} style={{ display: 'flex', alignItems: 'center', padding: '0.5rem 0.875rem', borderBottom: '1px solid #f3f4f6', gap: '0.5rem', fontSize: '0.8rem' }}>
                <span style={{ flex: 1, opacity: h.is_active ? 1 : 0.5 }}>{h.name}</span>
                <span style={{ color: '#6b7280', width: 70 }}>{h.fee_type}</span>
                {!h.is_active && <span style={{ fontSize: '0.7rem', color: '#9ca3af' }}>inactive</span>}
              </div>
            ))}
          </div>
        </div>

        <div>
          <h4 style={{ margin: '0 0 0.625rem', fontSize: '0.9rem' }}>Fee Schedules {yearId ? '' : '(select year)'}</h4>
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden' }}>
            {schedules.length === 0 && <p style={{ padding: '0.875rem', fontSize: '0.8rem', color: '#9ca3af' }}>No schedules for this year.</p>}
            {schedules.map((s) => (
              <div key={s.id} style={{ display: 'flex', padding: '0.5rem 0.875rem', borderBottom: '1px solid #f3f4f6', gap: '0.5rem', fontSize: '0.8rem', alignItems: 'center' }}>
                <span style={{ flex: 1 }}>{s.fee_head_name}</span>
                <span style={{ color: '#6b7280', width: 80 }}>{s.class_name ?? 'All Classes'}</span>
                <span style={{ fontWeight: 700, color: '#14463A', width: 80, textAlign: 'right' }}>{fmt(s.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Outstanding Tab ───────────────────────────────────────────────────────────
function OutstandingTab({ years, classes }: { years: AcademicYear[]; classes: Class[] }) {
  const [items, setItems] = useState<OutstandingStudent[]>([])
  const [grandTotal, setGrandTotal] = useState('0')
  const [yearId, setYearId] = useState(years.find((y) => y.is_current)?.id ?? '')
  const [classId, setClassId] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const r = await getOutstanding({ academic_year_id: yearId || undefined, class_id: classId || undefined })
      setItems(r.items)
      setGrandTotal(r.grand_total)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [yearId, classId])

  async function remind() {
    const ids = Array.from(selected)
    if (!ids.length) return
    const r = await sendReminders(ids)
    alert(`${r.queued} reminder(s) queued`)
    setSelected(new Set())
  }

  const SEL: preact.JSX.CSSProperties = { padding: '0.375rem 0.625rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.8rem' }

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.875rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={yearId} onChange={(e) => setYearId((e.target as HTMLSelectElement).value)} style={SEL}>
          <option value="">All years</option>
          {years.map((y) => <option key={y.id} value={y.id}>{y.name}{y.is_current ? ' ★' : ''}</option>)}
        </select>
        <select value={classId} onChange={(e) => setClassId((e.target as HTMLSelectElement).value)} style={SEL}>
          <option value="">All classes</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {selected.size > 0 && (
          <button onClick={remind} style={{ padding: '0.375rem 0.875rem', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' }}>
            Send Reminder ({selected.size})
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontWeight: 700, fontSize: '0.875rem' }}>
          Grand Total Due: <span style={{ color: '#dc2626' }}>{fmt(grandTotal)}</span>
        </span>
      </div>
      {loading ? <p style={{ color: '#9ca3af', fontSize: '0.875rem' }}>Loading…</p> : (
        <ScrollX minWidth={560}>
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ display: 'flex', padding: '0 1rem', height: 36, background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ width: 24 }}></span>
            <span style={{ flex: 1 }}>NAME</span>
            <span style={{ width: 90 }}>ADM NO</span>
            <span style={{ width: 100 }}>CLASS</span>
            <span style={{ width: 70, textAlign: 'center' }}>ENTRIES</span>
            <span style={{ width: 110, textAlign: 'right' }}>TOTAL DUE</span>
          </div>
          {items.length === 0 && <p style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af', fontSize: '0.875rem' }}>No outstanding dues. 🎉</p>}
          {items.map((s) => (
            <div key={s.student_id} style={{ display: 'flex', padding: '0.5rem 1rem', borderBottom: '1px solid #f3f4f6', gap: '0.75rem', fontSize: '0.8rem', alignItems: 'center' }}>
              <input type="checkbox" checked={selected.has(s.student_id)} onChange={(e) => setSelected((prev) => { const n = new Set(prev); (e.target as HTMLInputElement).checked ? n.add(s.student_id) : n.delete(s.student_id); return n })} />
              <span style={{ flex: 1, fontWeight: 500 }}>{s.student_name}</span>
              <span style={{ width: 90, color: '#6b7280' }}>{s.admission_no}</span>
              <span style={{ width: 100, color: '#6b7280' }}>{s.class_name} {s.section_name}</span>
              <span style={{ width: 70, textAlign: 'center', color: '#9ca3af' }}>{s.pending_entries}</span>
              <span style={{ width: 110, textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>{fmt(s.total_due)}</span>
            </div>
          ))}
        </div>
        </ScrollX>
      )}
    </div>
  )
}

// ── Defaulters Tab ────────────────────────────────────────────────────────────
function DefaultersTab({ years, classes }: { years: AcademicYear[]; classes: Class[] }) {
  const [yearId, setYearId] = useState(years.find((y) => y.is_current)?.id ?? '')
  const [classId, setClassId] = useState('')
  const [data, setData] = useState<{ total_students: number; defaulters: Defaulter[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  async function load() {
    setLoading(true)
    try {
      const r = await getDefaulters({
        academic_year_id: yearId || undefined,
        class_id: classId || undefined,
      })
      setData(r)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [yearId, classId])

  function toggleRow(id: string) {
    setExpanded((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function exportCsv() {
    const p = new URLSearchParams()
    if (yearId) p.set('academic_year_id', yearId)
    if (classId) p.set('class_id', classId)
    p.set('format', 'csv')
    window.open(`/api/v1/fees/defaulters?${p}`, '_blank')
  }

  const SEL: preact.JSX.CSSProperties = { padding: '0.375rem 0.625rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.8rem' }

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.875rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={yearId} onChange={(e) => setYearId((e.target as HTMLSelectElement).value)} style={SEL}>
          <option value="">All years</option>
          {years.map((y) => <option key={y.id} value={y.id}>{y.name}{y.is_current ? ' ★' : ''}</option>)}
        </select>
        <select value={classId} onChange={(e) => setClassId((e.target as HTMLSelectElement).value)} style={SEL}>
          <option value="">All classes</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button onClick={exportCsv} style={{ padding: '0.375rem 0.875rem', background: '#1F8A5D', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' }}>
          Export CSV
        </button>
        {data && (
          <span style={{ marginLeft: 'auto', fontSize: '0.875rem', fontWeight: 700, color: data.total_students > 0 ? '#dc2626' : '#1F8A5D' }}>
            {data.total_students} defaulter{data.total_students !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {loading && <p style={{ color: '#9ca3af', fontSize: '0.875rem' }}>Loading…</p>}
      {!loading && data && data.defaulters.length === 0 && (
        <p style={{ textAlign: 'center', color: '#1F8A5D', padding: '2rem', fontSize: '0.875rem' }}>No overdue fees. All caught up!</p>
      )}
      {!loading && data && data.defaulters.length > 0 && (
        <ScrollX minWidth={560}>
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ display: 'flex', padding: '0 1rem', height: 36, background: '#fef2f2', borderBottom: '1px solid #fecaca', fontSize: '0.75rem', fontWeight: 600, color: '#991b1b', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ flex: 1 }}>NAME</span>
            <span style={{ width: 90 }}>ADM NO</span>
            <span style={{ width: 110 }}>CLASS</span>
            <span style={{ width: 110, textAlign: 'right' }}>OVERDUE TOTAL</span>
            <span style={{ width: 24 }}></span>
          </div>
          {data.defaulters.map((d) => (
            <div key={d.student_id}>
              <div
                onClick={() => toggleRow(d.student_id)}
                style={{ display: 'flex', padding: '0.5rem 1rem', borderBottom: '1px solid #f3f4f6', gap: '0.75rem', fontSize: '0.8rem', alignItems: 'center', cursor: 'pointer', background: expanded.has(d.student_id) ? '#fff7f7' : '#fff' }}
              >
                <span style={{ flex: 1, fontWeight: 500 }}>{d.student_name}</span>
                <span style={{ width: 90, color: '#6b7280' }}>{d.admission_no}</span>
                <span style={{ width: 110, color: '#6b7280' }}>{d.class_name} {d.section_name}</span>
                <span style={{ width: 110, textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>{fmt(d.total_overdue)}</span>
                <span style={{ width: 24, textAlign: 'center', color: '#9ca3af' }}>{expanded.has(d.student_id) ? '▲' : '▼'}</span>
              </div>
              {expanded.has(d.student_id) && (
                <div style={{ background: '#fef9f9', borderBottom: '1px solid #f3f4f6', padding: '0.5rem 1rem 0.75rem 2rem' }}>
                  {d.entries.map((e) => (
                    <div key={e.id} style={{ display: 'flex', gap: '0.75rem', fontSize: '0.78rem', padding: '0.25rem 0', color: '#6b7280' }}>
                      <span style={{ flex: 1 }}>{e.fee_head_name} — {e.period}</span>
                      <span style={{ color: '#dc2626', fontWeight: 600 }}>{fmt(e.amount_due)}</span>
                      <span style={{ width: 100 }}>{e.due_date ? `Due ${e.due_date}` : ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        </ScrollX>
      )}
    </div>
  )
}

// ── Collect Fee Tab ───────────────────────────────────────────────────────────
const PAY_METHODS = [
  { v: 'cash', label: 'Cash' }, { v: 'upi', label: 'UPI' },
  { v: 'cheque', label: 'Cheque' }, { v: 'bank_transfer', label: 'Bank transfer' },
] as const
type PayMethod = typeof PAY_METHODS[number]['v']

function CollectTab() {
  const [admNo, setAdmNo] = useState('')
  const [ledger, setLedger] = useState<import('../types/finance').StudentLedger | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [method, setMethod] = useState<PayMethod>('cash')
  const [reference, setReference] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const [receiptUrl, setReceiptUrl] = useState('')

  async function loadStudent(e: Event) {
    e.preventDefault()
    setLoading(true); setLedger(null); setSelected(new Set()); setReceiptUrl(''); setStatus('')
    try {
      const { listStudents } = await import('../api/students')
      const res = await listStudents({ limit: 500 })
      const student = res.items.find((s) => s.admission_no === admNo)
      if (!student) { alert('Student not found'); return }
      const l = await getStudentLedger(student.id)
      setLedger(l)
    } catch (e) { alert(e instanceof Error ? e.message : 'Error') }
    finally { setLoading(false) }
  }

  // Reset after a completed collection so the next payment can start cleanly:
  // clear the selection (paid rows can't be re-submitted) and reload the ledger
  // so the paid months leave the pending list.
  async function finishCollection(paymentId: string, studentId: string) {
    setReceiptUrl(`/api/v1/payments/${paymentId}/receipt`)
    setStatus('paid')
    setSelected(new Set())
    setReference('')
    setLedger(await getStudentLedger(studentId))
  }

  async function pay() {
    if (!ledger || selected.size === 0) return
    setLoading(true)
    try {
      const res = await collectOffline({
        student_id: ledger.student_id,
        ledger_ids: Array.from(selected),
        method,
        reference_no: reference.trim() || undefined,
      })
      await finishCollection(res.payment_id, ledger.student_id)
    } catch (e) { alert(e instanceof Error ? e.message : 'Error') }
    finally { setLoading(false) }
  }

  const INP: preact.JSX.CSSProperties = { padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.875rem' }
  const totalSelected = ledger ? ledger.pending.filter((e) => selected.has(e.id)).reduce((s, e) => s + Number(e.amount_due), 0) : 0

  return (
    <div style={{ maxWidth: 560 }}>
      <form onSubmit={loadStudent} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <input value={admNo} onInput={(e) => setAdmNo((e.target as HTMLInputElement).value)} placeholder="Admission number" style={{ ...INP, flex: 1 }} required />
        <button type="submit" disabled={loading} style={{ padding: '0.5rem 1rem', background: '#14463A', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem' }}>Load</button>
      </form>

      {ledger && (
        <div>
          <p style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem' }}>{ledger.student_name} · {ledger.admission_no} · {ledger.class_section}</p>
          <p style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.5rem' }}>Select months to pay:</p>
          {ledger.pending.length === 0 && <p style={{ fontSize: '0.8rem', color: '#1F8A5D' }}>✓ No pending dues</p>}
          {ledger.pending.map((e) => (
            <label key={e.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0', borderBottom: '1px solid #f3f4f6', fontSize: '0.8rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={selected.has(e.id)} onChange={(ev) => {
                if (status === 'paid') { setStatus(''); setReceiptUrl('') }
                const checked = (ev.target as HTMLInputElement).checked
                setSelected((p) => { const n = new Set(p); checked ? n.add(e.id) : n.delete(e.id); return n })
              }} />
              <span style={{ flex: 1 }}>{periodLabel(e.period_month, e.period_year)} — {e.fee_head_name}</span>
              <span style={{ fontWeight: 700, color: '#14463A' }}>{fmt(e.amount_due)}</span>
            </label>
          ))}
          {selected.size > 0 && (
            <div style={{ marginTop: '1rem' }}>
              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.875rem' }}>Method:</span>
                {PAY_METHODS.map((m) => (
                  <button key={m.v} onClick={() => setMethod(m.v)} style={{ padding: '0.25rem 0.75rem', background: method === m.v ? '#14463A' : '#f3f4f6', color: method === m.v ? '#fff' : '#374151', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' }}>
                    {m.label}
                  </button>
                ))}
              </div>
              {method !== 'cash' && (
                <input value={reference} onInput={(e) => setReference((e.target as HTMLInputElement).value)}
                  placeholder={method === 'cheque' ? 'Cheque no. (optional)' : method === 'upi' ? 'UPI ref / UTR (optional)' : 'Reference no. (optional)'}
                  style={{ ...INP, width: '100%', marginBottom: '0.6rem' }} />
              )}
              <button onClick={pay} disabled={loading} style={{ padding: '0.625rem 1.25rem', background: '#1F8A5D', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600 }}>
                {loading ? 'Recording…' : `Collect ${fmt(totalSelected)} (${selected.size} item${selected.size !== 1 ? 's' : ''})`}
              </button>
            </div>
          )}
          {status === 'paid' && receiptUrl && (
            <div style={{ marginTop: '1rem', padding: '1rem', background: 'var(--c-success-lt)', borderRadius: 6, fontSize: '0.85rem', color: '#0D332A', fontWeight: 600 }}>
              ✓ Payment recorded. The dues below are updated and it now shows in the parent's Paid section.{' '}
              <a href={receiptUrl} target="_blank" rel="noreferrer" style={{ color: '#14463A' }}>View Receipt ↗</a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Logs Tab ──────────────────────────────────────────────────────────────────
function LogsTab() {
  const [logs, setLogs] = useState<import('../types/finance').FeePayment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getPaymentLogs(200).then((r) => setLogs(r as any)).finally(() => setLoading(false))
  }, [])

  const STATUS_COLORS: Record<string, string> = { paid: '#0D332A', pending: '#92400e', failed: '#991b1b', processing: '#0D332A' }
  const STATUS_BG: Record<string, string>     = { paid: '#d1fae5', pending: '#fef3c7', failed: '#fee2e2', processing: '#E7EFEA' }

  return (
    <div>
      {loading ? <p style={{ color: '#9ca3af', fontSize: '0.875rem' }}>Loading…</p> : (
        <ScrollX minWidth={620}>
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ display: 'flex', padding: '0 1rem', height: 36, background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ width: 120 }}>RECEIPT NO</span>
            <span style={{ flex: 1 }}>STUDENT</span>
            <span style={{ width: 80, textAlign: 'right' }}>AMOUNT</span>
            <span style={{ width: 70 }}>GATEWAY</span>
            <span style={{ width: 70 }}>STATUS</span>
            <span style={{ width: 90 }}>PAID AT</span>
          </div>
          {logs.length === 0 && <p style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af', fontSize: '0.875rem' }}>No payment records yet.</p>}
          {logs.map((p: any) => (
            <div key={p.id} style={{ display: 'flex', padding: '0.5rem 1rem', borderBottom: '1px solid #f3f4f6', gap: '0.75rem', fontSize: '0.8rem', alignItems: 'center' }}>
              <span style={{ width: 120, fontWeight: p.receipt_number ? 600 : 400, color: p.receipt_number ? '#14463A' : '#9ca3af' }}>
                {p.receipt_number ? (
                  <a href={`/api/v1/payments/${p.id}/receipt`} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>{p.receipt_number}</a>
                ) : '—'}
              </span>
              <span style={{ flex: 1 }}>{p.student_name ?? p.student_id}</span>
              <span style={{ width: 80, textAlign: 'right', fontWeight: 700 }}>{fmt(p.amount)}</span>
              <span style={{ width: 70, color: '#6b7280' }}>{p.gateway}</span>
              <span style={{ width: 70 }}>
                <span style={{ padding: '2px 7px', background: STATUS_BG[p.status] ?? '#f3f4f6', color: STATUS_COLORS[p.status] ?? '#374151', borderRadius: 9999, fontSize: '0.7rem', fontWeight: 600 }}>{p.status}</span>
              </span>
              <span style={{ width: 90, color: '#6b7280' }}>{p.paid_at ? new Date(p.paid_at).toLocaleDateString('en-IN') : '—'}</span>
            </div>
          ))}
        </div>
        </ScrollX>
      )}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function FeesAdminView() {
  const isMobile = useIsMobile()
  const [tab, setTab] = useState<Tab>('outstanding')
  const [years, setYears] = useState<AcademicYear[]>([])
  const [classes, setClasses] = useState<Class[]>([])

  useEffect(() => {
    Promise.all([listAcademicYears(), listClasses()]).then(([ys, cs]) => { setYears(ys); setClasses(cs) })
  }, [])

  const tabs: { id: Tab; label: string }[] = [
    { id: 'outstanding', label: 'Outstanding Dues' },
    { id: 'defaulters', label: 'Defaulters' },
    { id: 'collect', label: 'Collect Fee' },
    { id: 'logs', label: 'Payment Logs' },
    { id: 'structure', label: 'Fee Structure' },
  ]

  const TAB_BTN = (active: boolean): preact.JSX.CSSProperties => ({
    padding: '0.375rem 0.875rem', border: 'none', borderBottom: active ? '2px solid #14463A' : '2px solid transparent',
    background: 'none', color: active ? '#14463A' : '#6b7280', cursor: 'pointer', fontSize: '0.875rem', fontWeight: active ? 600 : 400,
  })

  return (
    <div style={{ padding: isMobile ? '1rem 0.75rem' : '1.5rem', fontFamily: 'system-ui, sans-serif' }}>
      <h2 style={{ margin: '0 0 1rem', fontSize: '1.25rem', fontWeight: 700 }}>Fees & Payments</h2>
      <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '1px solid #e5e7eb', marginBottom: '1.25rem', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        {tabs.map((t) => <button key={t.id} onClick={() => setTab(t.id)} style={{ ...TAB_BTN(tab === t.id), whiteSpace: 'nowrap', flexShrink: 0 }}>{t.label}</button>)}
      </div>
      {tab === 'structure'   && <StructureTab years={years} />}
      {tab === 'outstanding' && <OutstandingTab years={years} classes={classes} />}
      {tab === 'defaulters'  && <DefaultersTab years={years} classes={classes} />}
      {tab === 'collect'     && <CollectTab />}
      {tab === 'logs'        && <LogsTab />}
    </div>
  )
}
