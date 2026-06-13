import { useEffect, useMemo, useState } from 'preact/hooks'
import qrcode from 'qrcode-generator'
import {
  getStudentLedger, getStudentSummary, listMyStudents,
  listParentNotifications, markAllParentNotificationsRead, markParentNotificationRead,
} from '../api/parent'
import type { FeeLedgerEntry, LinkedStudent, ParentNotification, StudentSummary } from '../api/parent'

// ── Helpers ───────────────────────────────────────────────────────────────────

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function periodLabel(month: number | null, year: number): string {
  return month ? `${MONTHS[month]} ${year}` : `${year} (one-time)`
}

function inr(n: number) {
  return '₹' + n.toLocaleString('en-IN')
}

function upiUri(vpa: string, name: string, amount: number, note: string) {
  return `upi://pay?${new URLSearchParams({ pa: vpa, pn: name, am: amount.toFixed(2), cu: 'INR', tn: note })}`
}

// ── Pay Modal ─────────────────────────────────────────────────────────────────

function PayModal({ upi, schoolName, amount, note, onClose }: {
  upi: string; schoolName: string; amount: number; note: string; onClose: () => void
}) {
  const uri = upiUri(upi, schoolName, amount, note)
  const qr = qrcode(0, 'M')
  qr.addData(uri)
  qr.make()

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 300, padding: '1rem' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '16px 16px 12px 12px', padding: '1.5rem 1.25rem 1.25rem', width: '100%', maxWidth: 360, textAlign: 'center' }}>
        <div style={{ width: 36, height: 4, background: '#e5e7eb', borderRadius: 9999, margin: '0 auto .75rem' }} />
        <div style={{ fontSize: '.75rem', color: '#6b7280', marginBottom: '.2rem' }}>{note}</div>
        <div style={{ fontWeight: 800, fontSize: '2rem', color: '#111827', letterSpacing: '-.02em', marginBottom: '1rem' }}>
          {inr(amount)}
        </div>
        <img src={qr.createDataURL(5, 6)} alt="UPI QR" style={{ width: 190, height: 190, imageRendering: 'pixelated', borderRadius: 8, border: '1px solid #e5e7eb' }} />
        <div style={{ fontSize: '.7rem', color: '#9ca3af', margin: '.5rem 0 .875rem' }}>
          Scan with Google Pay · PhonePe · Paytm · BHIM
        </div>
        <a href={uri} style={{ display: 'block', background: '#1F8A5D', color: '#fff', padding: '.7rem', borderRadius: 8, textDecoration: 'none', fontWeight: 700, fontSize: '.95rem', marginBottom: '.5rem' }}>
          Open UPI app ↗
        </a>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: '.82rem', cursor: 'pointer', padding: '.25rem', fontFamily: 'inherit' }}>
          Cancel
        </button>
        <p style={{ fontSize: '.62rem', color: '#d1d5db', marginTop: '.625rem', marginBottom: 0 }}>
          The school office will confirm receipt and mark fees as paid.
        </p>
      </div>
    </div>
  )
}

// ── Attendance Ring ───────────────────────────────────────────────────────────

function AttendanceRing({ pct }: { pct: number }) {
  const r = 26, circ = 2 * Math.PI * r
  const color = pct >= 75 ? '#16a34a' : pct >= 60 ? '#ca8a04' : '#dc2626'
  return (
    <svg width={66} height={66} viewBox="0 0 66 66">
      <circle cx={33} cy={33} r={r} fill="none" stroke="#e5e7eb" strokeWidth={7} />
      <circle cx={33} cy={33} r={r} fill="none" stroke={color} strokeWidth={7}
        strokeDasharray={`${(pct / 100) * circ} ${circ}`}
        strokeLinecap="round" transform="rotate(-90 33 33)" />
      <text x={33} y={37} textAnchor="middle" fontSize={12} fontWeight="700" fill={color}>{pct}%</text>
    </svg>
  )
}

// ── Fee Breakdown Panel ───────────────────────────────────────────────────────

interface MonthGroup {
  key: string
  label: string
  entries: FeeLedgerEntry[]
  total: number
  allPaid: boolean
}

function FeeBreakdown({ studentId, totalBalance, upi, schoolName }: {
  studentId: string
  totalBalance: number
  upi: string | null
  schoolName: string
}) {
  const [entries, setEntries]   = useState<FeeLedgerEntry[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pay, setPay]           = useState<{ amount: number; note: string } | null>(null)
  const [open, setOpen]         = useState(false)

  useEffect(() => {
    if (!open || entries !== null) return
    getStudentLedger(studentId).then(setEntries).catch(() => setEntries([]))
  }, [open, studentId])

  const groups = useMemo<MonthGroup[]>(() => {
    if (!entries) return []
    const map = new Map<string, FeeLedgerEntry[]>()
    for (const e of entries) {
      const key = e.period_month ? `${e.period_year}-${String(e.period_month).padStart(2,'0')}` : `${e.period_year}-00`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(e)
    }
    return Array.from(map.entries()).map(([key, list]) => ({
      key,
      label: periodLabel(list[0].period_month, list[0].period_year),
      entries: list,
      total: list.reduce((s, e) => s + e.amount_due, 0),
      allPaid: list.every(e => e.status === 'paid'),
    }))
  }, [entries])

  const pendingGroups = groups.filter(g => !g.allPaid)
  const paidGroups    = groups.filter(g => g.allPaid)

  const selectedAmount = useMemo(() => {
    if (!entries) return 0
    return entries.filter(e => selected.has(e.id)).reduce((s, e) => s + e.amount_due, 0)
  }, [entries, selected])

  function toggleEntry(id: string) {
    setSelected(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  function toggleGroup(group: MonthGroup) {
    const ids = group.entries.filter(e => e.status !== 'paid').map(e => e.id)
    const allOn = ids.every(id => selected.has(id))
    setSelected(prev => {
      const n = new Set(prev)
      ids.forEach(id => allOn ? n.delete(id) : n.add(id))
      return n
    })
  }

  function selectAll() {
    if (!entries) return
    const pending = entries.filter(e => e.status !== 'paid').map(e => e.id)
    setSelected(new Set(pending))
  }

  function clearAll() { setSelected(new Set()) }

  const pendingEntries = entries?.filter(e => e.status !== 'paid') ?? []
  const allSelected = pendingEntries.length > 0 && pendingEntries.every(e => selected.has(e.id))

  return (
    <div>
      {/* Summary bar — always visible */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '.875rem 1rem', cursor: 'pointer', borderTop: '1px solid #f3f4f6' }}
      >
        <div>
          <div style={{ fontSize: '.7rem', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>Outstanding Fees</div>
          <div style={{ fontWeight: 700, fontSize: '1.35rem', color: totalBalance > 0 ? '#dc2626' : '#16a34a', marginTop: 2 }}>
            {inr(totalBalance)}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          {upi && totalBalance > 0 && !open && (
            <button
              onClick={e => { e.stopPropagation(); setPay({ amount: totalBalance, note: `${schoolName} — All Fees` }) }}
              style={{ background: '#1F8A5D', color: '#fff', border: 'none', borderRadius: 6, padding: '.35rem .7rem', fontSize: '.75rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Pay all
            </button>
          )}
          <span style={{ fontSize: '1.1rem', color: '#9ca3af', userSelect: 'none' }}>{open ? '▲' : '▼'}</span>
        </div>
      </div>

      {open && (
        <div style={{ borderTop: '1px solid #f3f4f6' }}>
          {entries === null ? (
            <p style={{ padding: '1.5rem', textAlign: 'center', color: '#9ca3af', fontSize: '.8rem' }}>Loading…</p>
          ) : entries.length === 0 ? (
            <p style={{ padding: '1.5rem', textAlign: 'center', color: '#16a34a', fontSize: '.85rem' }}>✓ No fees on record</p>
          ) : (
            <>
              {/* Select all / clear */}
              {pendingEntries.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '.5rem 1rem', background: '#f9fafb', borderBottom: '1px solid #f3f4f6' }}>
                  <button
                    onClick={allSelected ? clearAll : selectAll}
                    style={{ fontSize: '.72rem', color: '#14463A', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, padding: 0, fontFamily: 'inherit' }}
                  >
                    {allSelected ? 'Deselect all' : 'Select all pending'}
                  </button>
                  <span style={{ fontSize: '.7rem', color: '#6b7280' }}>{pendingEntries.length} pending</span>
                </div>
              )}

              {/* Pending month groups */}
              {pendingGroups.map(group => {
                const pendingInGroup = group.entries.filter(e => e.status !== 'paid')
                const groupSelected = pendingInGroup.length > 0 && pendingInGroup.every(e => selected.has(e.id))
                return (
                  <div key={group.key} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    {/* Month header row */}
                    <div
                      onClick={() => toggleGroup(group)}
                      style={{ display: 'flex', alignItems: 'center', padding: '.5rem 1rem', gap: '.625rem', cursor: 'pointer', background: groupSelected ? '#EDF3EE' : '#fff' }}
                    >
                      <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${groupSelected ? '#14463A' : '#d1d5db'}`, background: groupSelected ? '#14463A' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {groupSelected && <span style={{ color: '#fff', fontSize: 11, fontWeight: 900, lineHeight: 1 }}>✓</span>}
                      </div>
                      <span style={{ flex: 1, fontWeight: 600, fontSize: '.82rem', color: '#374151' }}>{group.label}</span>
                      <span style={{ fontWeight: 700, fontSize: '.82rem', color: '#dc2626' }}>{inr(group.total)}</span>
                    </div>

                    {/* Individual entries */}
                    {group.entries.map(entry => {
                      const isPaid = entry.status === 'paid'
                      const isSel  = selected.has(entry.id)
                      return (
                        <div
                          key={entry.id}
                          onClick={() => !isPaid && toggleEntry(entry.id)}
                          style={{ display: 'flex', alignItems: 'center', padding: '.4rem 1rem .4rem 2.75rem', gap: '.5rem', cursor: isPaid ? 'default' : 'pointer', background: isSel ? '#EDF3EE' : '#fff' }}
                        >
                          {!isPaid && (
                            <div style={{ width: 15, height: 15, borderRadius: 3, border: `2px solid ${isSel ? '#14463A' : '#d1d5db'}`, background: isSel ? '#14463A' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              {isSel && <span style={{ color: '#fff', fontSize: 9, fontWeight: 900, lineHeight: 1 }}>✓</span>}
                            </div>
                          )}
                          {isPaid && <span style={{ width: 15, fontSize: '.7rem', color: '#16a34a' }}>✓</span>}
                          <span style={{ flex: 1, fontSize: '.78rem', color: isPaid ? '#9ca3af' : '#6b7280' }}>{entry.fee_head_name}</span>
                          <span style={{ fontSize: '.78rem', fontWeight: 600, color: isPaid ? '#9ca3af' : '#374151', textDecoration: isPaid ? 'line-through' : 'none' }}>
                            {inr(entry.amount_due)}
                          </span>
                          {isPaid && <span style={{ fontSize: '.62rem', background: '#d1fae5', color: '#0D332A', borderRadius: 9999, padding: '1px 5px', fontWeight: 600 }}>PAID</span>}
                        </div>
                      )
                    })}
                  </div>
                )
              })}

              {/* Paid history — collapsed by default */}
              {paidGroups.length > 0 && (
                <div style={{ borderTop: '1px solid #f3f4f6' }}>
                  <div style={{ padding: '.5rem 1rem', fontSize: '.7rem', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                    Paid — {paidGroups.length} month{paidGroups.length > 1 ? 's' : ''}
                  </div>
                  {paidGroups.map(group => (
                    <div key={group.key} style={{ display: 'flex', padding: '.4rem 1rem', gap: '.5rem', alignItems: 'center', borderBottom: '1px solid #f9fafb' }}>
                      <span style={{ color: '#16a34a', fontSize: '.75rem' }}>✓</span>
                      <span style={{ flex: 1, fontSize: '.78rem', color: '#9ca3af' }}>{group.label}</span>
                      <span style={{ fontSize: '.75rem', color: '#9ca3af', textDecoration: 'line-through' }}>{inr(group.total)}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Pay selected sticky bar */}
              {selected.size > 0 && (
                <div style={{ position: 'sticky', bottom: 0, padding: '.875rem 1rem', background: '#fff', borderTop: '2px solid #14463A', display: 'flex', alignItems: 'center', gap: '.75rem' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '.68rem', color: '#6b7280' }}>{selected.size} item{selected.size > 1 ? 's' : ''} selected</div>
                    <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#111827' }}>{inr(selectedAmount)}</div>
                  </div>
                  {upi ? (
                    <button
                      onClick={() => setPay({ amount: selectedAmount, note: `${schoolName} — Fee Payment` })}
                      style={{ background: '#14463A', color: '#fff', border: 'none', borderRadius: 8, padding: '.6rem 1rem', fontWeight: 700, fontSize: '.85rem', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}
                    >
                      Pay via UPI ↗
                    </button>
                  ) : (
                    <span style={{ fontSize: '.72rem', color: '#9ca3af' }}>Pay at school office</span>
                  )}
                </div>
              )}

              {/* Pay all button when nothing selected */}
              {selected.size === 0 && upi && totalBalance > 0 && (
                <div style={{ padding: '.875rem 1rem', borderTop: '1px solid #f3f4f6' }}>
                  <button
                    onClick={() => setPay({ amount: totalBalance, note: `${schoolName} — All Fees` })}
                    style={{ width: '100%', background: '#1F8A5D', color: '#fff', border: 'none', borderRadius: 8, padding: '.65rem', fontWeight: 700, fontSize: '.9rem', cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    Pay all {inr(totalBalance)} via UPI
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {pay && upi && (
        <PayModal upi={upi} schoolName={schoolName} amount={pay.amount} note={pay.note} onClose={() => setPay(null)} />
      )}
    </div>
  )
}

// ── Homework Item ─────────────────────────────────────────────────────────────

const PILL: Record<string, { bg: string; color: string }> = {
  homework:     { bg: '#E7EFEA', color: '#0D332A' },
  announcement: { bg: '#fef3c7', color: '#92400e' },
  resource:     { bg: '#d1fae5', color: '#0D332A' },
}

// ── Summary Card ──────────────────────────────────────────────────────────────

function SummaryCard({ summary }: { summary: StudentSummary }) {
  const { student, attendance, fees, recent_homework, school_upi_id, school_name } = summary
  const att = attendance

  return (
    <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,.08)', overflow: 'hidden', marginBottom: '1rem' }}>

      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg,#14463A,#0D332A)', color: '#fff', padding: '1rem 1rem .875rem' }}>
        <div style={{ fontWeight: 800, fontSize: '1.05rem', letterSpacing: '-.01em' }}>
          {student.first_name} {student.last_name}
        </div>
        <div style={{ fontSize: '.72rem', opacity: .75, marginTop: 2 }}>
          {student.class_name} {student.section_name} · Roll {student.roll_number} · {student.admission_no}
        </div>
      </div>

      {/* Attendance strip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '.875rem 1rem', borderBottom: '1px solid #f3f4f6' }}>
        <AttendanceRing pct={att.percentage} />
        <div>
          <div style={{ fontSize: '.7rem', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>Attendance</div>
          <div style={{ fontWeight: 700, fontSize: '1rem', color: '#111827', marginTop: 1 }}>{att.present} / {att.total_sessions} days</div>
          <div style={{ fontSize: '.7rem', color: att.percentage >= 75 ? '#16a34a' : '#dc2626', fontWeight: 600, marginTop: 1 }}>
            {att.percentage >= 75 ? 'Good standing' : 'Below 75% — attend more'}
          </div>
        </div>
      </div>

      {/* Fee breakdown (expandable) */}
      <FeeBreakdown
        studentId={student.id}
        totalBalance={fees.total_balance}
        upi={school_upi_id}
        schoolName={school_name}
      />

      {/* Homework / Activity */}
      {recent_homework.length > 0 && (
        <div style={{ padding: '.875rem 1rem', borderTop: '1px solid #f3f4f6' }}>
          <div style={{ fontSize: '.7rem', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: '.625rem' }}>
            Recent Activity
          </div>
          {recent_homework.slice(0, 5).map(h => {
            const pill = PILL[h.post_type] ?? PILL.homework
            return (
              <div key={h.id} style={{ display: 'flex', gap: '.5rem', marginBottom: '.5rem', paddingBottom: '.5rem', borderBottom: '1px solid #f9fafb', alignItems: 'flex-start' }}>
                <span style={{ ...pill, padding: '1px 6px', borderRadius: 9999, fontSize: '.6rem', fontWeight: 700, flexShrink: 0, marginTop: 3, textTransform: 'uppercase' }}>
                  {h.post_type}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '.82rem', fontWeight: 600, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.title}</div>
                  <div style={{ fontSize: '.7rem', color: '#6b7280' }}>
                    {h.subject}{h.due_date ? ` · Due ${h.due_date}` : ''}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Updates Card (notifications) ──────────────────────────────────────────────

const NOTIF_ICON: Record<string, string> = {
  ABSENT:         '⚠️',
  FEE_RECEIPT:    '🧾',
  FEE_OVERDUE:    '₹',
  HOMEWORK:       '📚',
  EXAM_PUBLISHED: '📝',
}

function notifAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

const UPDATES_POLL_MS = 45000

function UpdatesCard() {
  const [items, setItems] = useState<ParentNotification[]>([])
  const [loaded, setLoaded] = useState(false)

  async function load() {
    try { setItems(await listParentNotifications()) } catch { /* keep last */ } finally { setLoaded(true) }
  }

  useEffect(() => {
    load()
    const t = setInterval(load, UPDATES_POLL_MS)
    const onVis = () => { if (!document.hidden) load() }
    window.addEventListener('focus', load)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', load)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  const unread = items.filter(i => !i.read_at).length

  async function tap(n: ParentNotification) {
    if (n.read_at) return
    try { await markParentNotificationRead(n.id) } catch { /* ignore */ }
    const now = new Date().toISOString()
    setItems(prev => prev.map(i => (i.id === n.id ? { ...i, read_at: now } : i)))
  }

  async function markAll() {
    try { await markAllParentNotificationsRead() } catch { /* ignore */ }
    const now = new Date().toISOString()
    setItems(prev => prev.map(i => ({ ...i, read_at: i.read_at ?? now })))
  }

  if (!loaded || items.length === 0) return null

  return (
    <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,.08)', overflow: 'hidden', marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '.75rem 1rem', borderBottom: '1px solid #f3f4f6' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
          <span style={{ fontSize: '.7rem', color: '#6b7280', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>Updates</span>
          {unread > 0 && (
            <span style={{ background: '#ef4444', color: '#fff', borderRadius: 9999, fontSize: '.62rem', fontWeight: 700, padding: '1px 6px' }}>{unread}</span>
          )}
        </div>
        {unread > 0 && (
          <button onClick={markAll} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#14463A', fontSize: '.72rem', fontFamily: 'inherit', padding: 0 }}>
            Mark all read
          </button>
        )}
      </div>
      {items.slice(0, 15).map(n => (
        <div
          key={n.id}
          onClick={() => tap(n)}
          style={{
            display: 'flex', gap: '.6rem', padding: '.6rem 1rem',
            borderBottom: '1px solid #f9fafb', alignItems: 'flex-start',
            cursor: n.read_at ? 'default' : 'pointer',
            background: n.read_at ? '#fff' : 'rgba(20,70,58,.04)',
          }}
        >
          <span style={{ fontSize: '1rem', flexShrink: 0, marginTop: 1 }}>{NOTIF_ICON[n.type] ?? '🔔'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '.5rem' }}>
              <span style={{ fontWeight: 600, fontSize: '.82rem', color: '#111827', flex: 1 }}>{n.title}</span>
              <span style={{ fontSize: '.64rem', color: '#9ca3af', flexShrink: 0 }}>{notifAgo(n.created_at)}</span>
            </div>
            {n.body && <div style={{ fontSize: '.74rem', color: '#6b7280', marginTop: 1 }}>{n.body}</div>}
          </div>
          {!n.read_at && <span style={{ width: 7, height: 7, borderRadius: 4, background: '#14463A', flexShrink: 0, marginTop: 6 }} />}
        </div>
      ))}
    </div>
  )
}

// ── Parent Portal View ────────────────────────────────────────────────────────

export function ParentPortalView({ onLogout }: { onLogout: () => void }) {
  const [students, setStudents]   = useState<LinkedStudent[]>([])
  const [summaries, setSummaries] = useState<Record<string, StudentSummary>>({})
  const [loading, setLoading]     = useState(true)
  const [err, setErr]             = useState('')

  useEffect(() => {
    listMyStudents()
      .then(async ss => {
        setStudents(ss)
        const results = await Promise.all(ss.map(s => getStudentSummary(s.id)))
        const map: Record<string, StudentSummary> = {}
        ss.forEach((s, i) => { map[s.id] = results[i] })
        setSummaries(map)
      })
      .catch(e => setErr(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: '#f3f4f6', fontFamily: 'system-ui,-apple-system,sans-serif' }}>
      <header style={{ background: '#14463A', color: '#fff', padding: '.875rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 10 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-.01em' }}>Tulips.edu</div>
          <div style={{ fontSize: '.68rem', opacity: .75 }}>Parent Portal</div>
        </div>
        <button onClick={onLogout} style={{ background: 'rgba(255,255,255,.15)', color: '#fff', border: '1px solid rgba(255,255,255,.25)', borderRadius: 5, padding: '.3rem .75rem', cursor: 'pointer', fontSize: '.78rem', fontFamily: 'inherit' }}>
          Sign out
        </button>
      </header>

      <main style={{ maxWidth: 480, margin: '0 auto', padding: '1rem' }}>
        {loading && <p style={{ textAlign: 'center', color: '#9ca3af', padding: '3rem 0', fontSize: '.875rem' }}>Loading…</p>}
        {err    && <p style={{ textAlign: 'center', color: '#ef4444', fontSize: '.875rem' }}>{err}</p>}
        {!loading && students.length === 0 && !err && (
          <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#6b7280' }}>
            <p style={{ fontSize: '.9rem', marginBottom: '.5rem' }}>No student linked to this account.</p>
            <p style={{ fontSize: '.8rem' }}>Contact the school administration.</p>
          </div>
        )}
        {!loading && !err && <UpdatesCard />}
        {students.map(s =>
          summaries[s.id]
            ? <SummaryCard key={s.id} summary={summaries[s.id]} />
            : <div key={s.id} style={{ background: '#fff', borderRadius: 12, padding: '1rem', marginBottom: '1rem', color: '#9ca3af', fontSize: '.875rem' }}>Loading {s.first_name}…</div>
        )}
      </main>
    </div>
  )
}
