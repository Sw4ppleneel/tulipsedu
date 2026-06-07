import { useEffect, useState } from 'preact/hooks'
import {
  createOrder, getOutstanding, getPaymentLogs, getStudentLedger,
  listFeeHeads, listSchedules, mockComplete, pollPayment, sendReminders,
} from '../api/finance'
import { listAcademicYears, listClasses } from '../api/students'
import type { AcademicYear, Class } from '../types/student'
import type { FeeHead, FeeSchedule, OutstandingStudent } from '../types/finance'

type Tab = 'structure' | 'outstanding' | 'logs' | 'collect'

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
            style={{ padding: '0.375rem 0.875rem', background: (!xlsxFile || !yearId || busy) ? '#9ca3af' : '#059669', color: '#fff', border: 'none', borderRadius: 4, cursor: (!xlsxFile || !yearId || busy) ? 'default' : 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
          >
            {busy ? 'Applying…' : 'Upload & Apply'}
          </button>
        </div>
        {result && <p style={{ margin: '0.75rem 0 0', fontSize: '0.78rem', color: '#059669', fontWeight: 600 }}>{result}</p>}
      </div>

      {/* Read-only view of what is configured */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
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
                <span style={{ fontWeight: 700, color: '#1a56db', width: 80, textAlign: 'right' }}>{fmt(s.amount)}</span>
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
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.875rem', alignItems: 'center' }}>
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
      )}
    </div>
  )
}

// ── Collect Fee Tab ───────────────────────────────────────────────────────────
function CollectTab() {
  const [admNo, setAdmNo] = useState('')
  const [ledger, setLedger] = useState<import('../types/finance').StudentLedger | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [gateway, setGateway] = useState<'razorpay' | 'phonepe' | 'mock'>('mock')
  const [order, setOrder] = useState<import('../types/finance').PaymentOrder | null>(null)
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const [pollingId, setPollingId] = useState<ReturnType<typeof setInterval> | null>(null)
  const [receiptUrl, setReceiptUrl] = useState('')

  async function loadStudent(e: Event) {
    e.preventDefault()
    setLoading(true); setLedger(null); setOrder(null); setSelected(new Set()); setReceiptUrl('')
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

  async function pay() {
    if (!ledger || selected.size === 0) return
    setLoading(true)
    try {
      const o = await createOrder({ student_id: ledger.student_id, ledger_ids: Array.from(selected), gateway })
      setOrder(o)
      if (gateway === 'mock') {
        const paid = await mockComplete(o.payment_id)
        setStatus(paid.status)
        setReceiptUrl(`/api/v1/payments/${o.payment_id}/receipt`)
        if (ledger) {
          const updated = await getStudentLedger(ledger.student_id)
          setLedger(updated)
        }
      } else {
        const id = setInterval(async () => {
          const p = await pollPayment(o.payment_id)
          setStatus(p.status)
          if (p.status === 'paid') {
            clearInterval(id); setPollingId(null)
            setReceiptUrl(`/api/v1/payments/${o.payment_id}/receipt`)
            if (ledger) setLedger(await getStudentLedger(ledger.student_id))
          }
        }, 3000)
        setPollingId(id)
      }
    } catch (e) { alert(e instanceof Error ? e.message : 'Error') }
    finally { setLoading(false) }
  }

  const INP: preact.JSX.CSSProperties = { padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.875rem' }
  const totalSelected = ledger ? ledger.pending.filter((e) => selected.has(e.id)).reduce((s, e) => s + Number(e.amount_due), 0) : 0

  return (
    <div style={{ maxWidth: 560 }}>
      <form onSubmit={loadStudent} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <input value={admNo} onInput={(e) => setAdmNo((e.target as HTMLInputElement).value)} placeholder="Admission number" style={{ ...INP, flex: 1 }} required />
        <button type="submit" disabled={loading} style={{ padding: '0.5rem 1rem', background: '#1a56db', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem' }}>Load</button>
      </form>

      {ledger && (
        <div>
          <p style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem' }}>{ledger.student_name} · {ledger.admission_no} · {ledger.class_section}</p>
          <p style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.5rem' }}>Select months to pay:</p>
          {ledger.pending.length === 0 && <p style={{ fontSize: '0.8rem', color: '#059669' }}>✓ No pending dues</p>}
          {ledger.pending.map((e) => (
            <label key={e.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0', borderBottom: '1px solid #f3f4f6', fontSize: '0.8rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={selected.has(e.id)} onChange={(ev) => setSelected((p) => { const n = new Set(p); (ev.target as HTMLInputElement).checked ? n.add(e.id) : n.delete(e.id); return n })} />
              <span style={{ flex: 1 }}>{periodLabel(e.period_month, e.period_year)} — {e.fee_head_name}</span>
              <span style={{ fontWeight: 700, color: '#1a56db' }}>{fmt(e.amount_due)}</span>
            </label>
          ))}
          {selected.size > 0 && (
            <div style={{ marginTop: '1rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
                <span style={{ fontSize: '0.875rem' }}>Gateway:</span>
                {(['razorpay', 'phonepe', 'mock'] as const).map((g) => (
                  <button key={g} onClick={() => setGateway(g)} style={{ padding: '0.25rem 0.75rem', background: gateway === g ? '#1a56db' : '#f3f4f6', color: gateway === g ? '#fff' : '#374151', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' }}>
                    {g === 'mock' ? 'Test (Mock)' : g.charAt(0).toUpperCase() + g.slice(1)}
                  </button>
                ))}
              </div>
              <button onClick={pay} disabled={loading || !!order} style={{ padding: '0.625rem 1.25rem', background: '#059669', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600 }}>
                Pay {fmt(totalSelected)} ({selected.size} item{selected.size !== 1 ? 's' : ''})
              </button>
            </div>
          )}
          {order && (
            <div style={{ marginTop: '1rem', padding: '1rem', background: '#f5f7ff', borderRadius: 6, fontSize: '0.85rem' }}>
              {order.payment_url && gateway !== 'mock' && (
                <p>
                  <a href={order.payment_url} target="_blank" rel="noreferrer" style={{ color: '#1a56db', fontWeight: 600 }}>Open Payment Page ↗</a>
                  {pollingId && <span style={{ color: '#9ca3af', marginLeft: '0.5rem' }}>Waiting for payment…</span>}
                </p>
              )}
              {status === 'paid' && (
                <div style={{ color: '#065f46', fontWeight: 600, marginTop: '0.5rem' }}>
                  ✓ Payment successful!{' '}
                  <a href={receiptUrl} target="_blank" rel="noreferrer" style={{ color: '#1a56db' }}>View Receipt ↗</a>
                </div>
              )}
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

  const STATUS_COLORS: Record<string, string> = { paid: '#065f46', pending: '#92400e', failed: '#991b1b', processing: '#1e40af' }
  const STATUS_BG: Record<string, string>     = { paid: '#d1fae5', pending: '#fef3c7', failed: '#fee2e2', processing: '#dbeafe' }

  return (
    <div>
      {loading ? <p style={{ color: '#9ca3af', fontSize: '0.875rem' }}>Loading…</p> : (
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
              <span style={{ width: 120, fontWeight: p.receipt_number ? 600 : 400, color: p.receipt_number ? '#1a56db' : '#9ca3af' }}>
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
      )}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function FeesAdminView() {
  const [tab, setTab] = useState<Tab>('outstanding')
  const [years, setYears] = useState<AcademicYear[]>([])
  const [classes, setClasses] = useState<Class[]>([])

  useEffect(() => {
    Promise.all([listAcademicYears(), listClasses()]).then(([ys, cs]) => { setYears(ys); setClasses(cs) })
  }, [])

  const tabs: { id: Tab; label: string }[] = [
    { id: 'outstanding', label: 'Outstanding Dues' },
    { id: 'collect', label: 'Collect Fee' },
    { id: 'logs', label: 'Payment Logs' },
    { id: 'structure', label: 'Fee Structure' },
  ]

  const TAB_BTN = (active: boolean): preact.JSX.CSSProperties => ({
    padding: '0.375rem 0.875rem', border: 'none', borderBottom: active ? '2px solid #1a56db' : '2px solid transparent',
    background: 'none', color: active ? '#1a56db' : '#6b7280', cursor: 'pointer', fontSize: '0.875rem', fontWeight: active ? 600 : 400,
  })

  return (
    <div style={{ padding: '1.5rem', fontFamily: 'system-ui, sans-serif' }}>
      <h2 style={{ margin: '0 0 1rem', fontSize: '1.25rem', fontWeight: 700 }}>Fees & Payments</h2>
      <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '1px solid #e5e7eb', marginBottom: '1.25rem' }}>
        {tabs.map((t) => <button key={t.id} onClick={() => setTab(t.id)} style={TAB_BTN(tab === t.id)}>{t.label}</button>)}
      </div>
      {tab === 'structure'   && <StructureTab years={years} />}
      {tab === 'outstanding' && <OutstandingTab years={years} classes={classes} />}
      {tab === 'collect'     && <CollectTab />}
      {tab === 'logs'        && <LogsTab />}
    </div>
  )
}
