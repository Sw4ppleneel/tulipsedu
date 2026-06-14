import { useEffect, useMemo, useState } from 'preact/hooks'
import qrcode from 'qrcode-generator'
import {
  getStudentLedger, getStudentResults, getStudentSummary, listMyStudents,
  listParentNotifications, submitParentPayment, listParentPayments, downloadReportCard,
} from '../api/parent'
import type {
  FeeLedgerEntry, LinkedStudent, ParentNotification, ParentPayment, StudentSummary,
  TermResultSheet,
} from '../api/parent'
import { Brand, Card, Icon, SectionTile, Spinner, EmptyState, type IconName } from '../ui'

// ── Helpers ───────────────────────────────────────────────────────────────────
const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const periodLabel = (m: number | null, y: number) => (m ? `${MONTHS[m]} ${y}` : `${y} (one-time)`)
const inr = (n: number) => '₹' + n.toLocaleString('en-IN')
const upiUri = (vpa: string, name: string, amount: number, note: string) =>
  `upi://pay?${new URLSearchParams({ pa: vpa, pn: name, am: amount.toFixed(2), cu: 'INR', tn: note })}`

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

// ── Pay + claim modal: QR → open app → "I've paid" (UTR optional) ─────────────
function PayClaimModal({ upi, schoolName, amount, note, onClose, onClaim }: {
  upi: string; schoolName: string; amount: number; note: string
  onClose: () => void; onClaim: (utr: string) => Promise<void>
}) {
  const [step, setStep] = useState<'pay' | 'confirm'>('pay')
  const [utr, setUtr] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const uri = upiUri(upi, schoolName, amount, note)
  const qr = qrcode(0, 'M'); qr.addData(uri); qr.make()

  async function confirm() {
    setBusy(true); setErr('')
    try { await onClaim(utr.trim()) }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); setBusy(false) }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(13,51,42,.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 300, padding: '1rem' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '16px 16px 12px 12px', padding: '1.5rem 1.25rem 1.25rem', width: '100%', maxWidth: 360, textAlign: 'center' }}>
        <div style={{ width: 36, height: 4, background: 'var(--gray-200)', borderRadius: 9999, margin: '0 auto .9rem' }} />
        <div class="text-xs text-muted" style={{ marginBottom: '.2rem' }}>{note}</div>
        <div style={{ fontWeight: 800, fontSize: '2rem', color: 'var(--gray-900)', fontFamily: 'var(--font-display)', marginBottom: '1rem' }}>{inr(amount)}</div>

        {step === 'pay' ? (
          <>
            <img src={qr.createDataURL(5, 6)} alt="UPI QR" style={{ width: 190, height: 190, imageRendering: 'pixelated', borderRadius: 8, border: '1px solid var(--gray-200)' }} />
            <div class="text-xs text-muted" style={{ margin: '.5rem 0 .875rem' }}>Scan with Google Pay · PhonePe · Paytm · BHIM</div>
            <a href={uri} class="btn btn-accent btn-lg" style={{ display: 'block', width: '100%', marginBottom: '.5rem', textDecoration: 'none' }}>Open UPI app</a>
            <button class="btn btn-primary btn-lg" style={{ width: '100%' }} onClick={() => setStep('confirm')}>I’ve paid →</button>
            <button onClick={onClose} class="text-sm text-muted" style={{ background: 'none', border: 'none', cursor: 'pointer', marginTop: '.7rem', fontFamily: 'inherit' }}>Cancel</button>
          </>
        ) : (
          <>
            <p class="text-sm text-muted" style={{ marginBottom: '.9rem' }}>
              Enter the UPI reference / UTR number from your payment app (optional, but it helps the office confirm faster).
            </p>
            <input class="input" value={utr} placeholder="UTR / reference no. (optional)"
              onInput={e => setUtr((e.target as HTMLInputElement).value)} style={{ marginBottom: '.75rem', textAlign: 'center' }} />
            {err && <div class="err" style={{ marginBottom: '.6rem' }}>{err}</div>}
            <button class="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={busy} onClick={confirm}>
              {busy ? 'Submitting…' : 'Submit for approval'}
            </button>
            <button onClick={() => setStep('pay')} class="text-sm text-muted" style={{ background: 'none', border: 'none', cursor: 'pointer', marginTop: '.7rem', fontFamily: 'inherit' }}>← Back</button>
          </>
        )}
        <p class="text-xs" style={{ color: 'var(--gray-400)', marginTop: '.8rem', marginBottom: 0 }}>
          The school office verifies the payment before marking it paid.
        </p>
      </div>
    </div>
  )
}

// ── Attendance ring ───────────────────────────────────────────────────────────
function AttendanceRing({ pct }: { pct: number }) {
  const r = 30, circ = 2 * Math.PI * r
  const color = pct >= 75 ? 'var(--c-success)' : pct >= 60 ? 'var(--c-warn)' : 'var(--c-accent)'
  return (
    <svg width={76} height={76} viewBox="0 0 76 76">
      <circle cx={38} cy={38} r={r} fill="none" stroke="var(--gray-200)" strokeWidth={8} />
      <circle cx={38} cy={38} r={r} fill="none" stroke={color} strokeWidth={8}
        strokeDasharray={`${(pct / 100) * circ} ${circ}`} strokeLinecap="round" transform="rotate(-90 38 38)" />
      <text x={38} y={43} textAnchor="middle" fontSize={15} fontWeight="700" fill={color}>{pct}%</text>
    </svg>
  )
}

// ── Fees section: Due (month groups) + Paid (claims) tabs ─────────────────────
interface MonthGroup { key: string; label: string; entries: FeeLedgerEntry[]; total: number }

function FeesSection({ student, schoolName, upi }: { student: LinkedStudent; schoolName: string; upi: string | null }) {
  const [tab, setTab] = useState<'due' | 'paid'>('due')
  const [ledger, setLedger] = useState<FeeLedgerEntry[] | null>(null)
  const [payments, setPayments] = useState<ParentPayment[] | null>(null)
  const [pay, setPay] = useState<{ amount: number; ledgerIds: string[]; note: string } | null>(null)

  async function reload() {
    const [l, p] = await Promise.all([getStudentLedger(student.id), listParentPayments()])
    setLedger(l); setPayments(p)
  }
  useEffect(() => { reload() }, [student.id])

  const dueGroups = useMemo<MonthGroup[]>(() => {
    if (!ledger) return []
    const map = new Map<string, FeeLedgerEntry[]>()
    for (const e of ledger) {
      if (e.status === 'paid' || e.status === 'waived') continue
      const key = e.period_month ? `${e.period_year}-${String(e.period_month).padStart(2, '0')}` : `${e.period_year}-00`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(e)
    }
    return [...map.entries()].sort().map(([key, list]) => ({
      key, label: periodLabel(list[0].period_month, list[0].period_year),
      entries: list, total: list.reduce((s, e) => s + e.amount_due, 0),
    }))
  }, [ledger])

  const claimedPending = (payments ?? []).some(p => p.status === 'pending_verification')

  if (!ledger || !payments) return <Spinner label="Loading fees…" />

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '1rem' }}>
      <div style={{ display: 'flex', gap: '.4rem', marginBottom: '1rem' }}>
        {(['due', 'paid'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} class={`btn ${tab === t ? 'btn-primary' : 'btn-ghost'} btn-sm`} style={{ flex: 1 }}>
            {t === 'due' ? 'Due' : 'Paid'}
          </button>
        ))}
      </div>

      {tab === 'due' ? (
        dueGroups.length === 0
          ? <EmptyState icon={<Icon name="fees" size={30} />} title="No dues" hint="All fees are cleared." />
          : dueGroups.map(g => (
            <Card key={g.key} pad={false} style={{ marginBottom: '.75rem', padding: '.9rem 1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontWeight: 700, fontFamily: 'var(--font-display)' }}>{g.label}</div>
                  <div class="text-xs text-muted">{g.entries.map(e => e.fee_head_name).join(' · ')}</div>
                </div>
                <div style={{ fontWeight: 800, color: 'var(--c-accent-dk)', fontSize: '1.15rem' }}>{inr(g.total)}</div>
              </div>
              <button
                class="btn btn-accent" style={{ width: '100%', marginTop: '.7rem' }}
                disabled={!upi}
                onClick={() => setPay({ amount: g.total, ledgerIds: g.entries.map(e => e.id), note: `${schoolName} | ${student.first_name} ${student.last_name} | Adm ${student.admission_no} | ${g.label}` })}
              >
                {upi ? `Pay ${inr(g.total)} via UPI` : 'Pay at school office'}
              </button>
            </Card>
          ))
      ) : (
        payments.length === 0
          ? <EmptyState icon={<Icon name="fees" size={30} />} title="No payments yet" hint="Payments you submit appear here for approval." />
          : payments.map(p => <PaymentRow key={p.id} p={p} />)
      )}

      {claimedPending && tab === 'due' && (
        <p class="text-xs text-muted" style={{ textAlign: 'center', marginTop: '.5rem' }}>
          You have a payment awaiting approval — see the <b>Paid</b> tab.
        </p>
      )}

      {pay && upi && (
        <PayClaimModal
          upi={upi} schoolName={schoolName} amount={pay.amount} note={pay.note}
          onClose={() => setPay(null)}
          onClaim={async (utr) => { await submitParentPayment(pay.ledgerIds, utr); setPay(null); setTab('paid'); await reload() }}
        />
      )}
    </div>
  )
}

function PaymentRow({ p }: { p: ParentPayment }) {
  const tone = p.status === 'paid' ? { bg: 'var(--c-success-lt)', fg: 'var(--c-success)', label: 'Paid' }
    : p.status === 'rejected' ? { bg: 'var(--c-accent-lt)', fg: 'var(--c-accent-dk)', label: 'Not verified' }
    : { bg: 'var(--c-warn-lt)', fg: 'var(--c-warn)', label: 'Pending approval' }
  return (
    <Card pad={false} style={{ marginBottom: '.6rem', padding: '.8rem 1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>{inr(p.amount)}</div>
          <div class="text-xs text-muted">{p.periods || '—'} · {fmtDate(p.created_at)}{p.reference_no ? ` · UTR ${p.reference_no}` : ''}</div>
          {p.status === 'rejected' && p.rejection_reason && <div class="text-xs" style={{ color: 'var(--c-accent-dk)' }}>{p.rejection_reason}</div>}
        </div>
        <span class="badge" style={{ background: tone.bg, color: tone.fg, flexShrink: 0 }}>{tone.label}</span>
      </div>
    </Card>
  )
}

// ── Attendance section (summary + day-wise absences from notifications) ───────
function AttendanceSection({ summary, absences }: { summary: StudentSummary; absences: ParentNotification[] }) {
  const a = summary.attendance
  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '1rem' }}>
      <Card style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
        <AttendanceRing pct={a.percentage} />
        <div>
          <div class="text-xs text-muted" style={{ textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600 }}>Attendance</div>
          <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{a.present} / {a.total_sessions} days</div>
          <div class="text-xs" style={{ color: a.percentage >= 75 ? 'var(--c-success)' : 'var(--c-accent-dk)', fontWeight: 600 }}>
            {a.percentage >= 75 ? 'Good standing' : 'Below 75% — please ensure regular attendance'}
          </div>
        </div>
      </Card>
      <div class="text-xs text-muted" style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', margin: '0 .25rem .5rem' }}>Recent absences</div>
      {absences.length === 0
        ? <EmptyState icon={<Icon name="attendance" size={28} />} title="No recent absences" />
        : absences.map(n => (
          <Card key={n.id} pad={false} style={{ marginBottom: '.5rem', padding: '.7rem 1rem' }}>
            <div style={{ fontWeight: 600, fontSize: '.85rem' }}>{n.title}</div>
            <div class="text-xs text-muted">{n.body}</div>
          </Card>
        ))}
    </div>
  )
}

// ── Generic feed (homework / announcements) ───────────────────────────────────
function FeedSection({ items, empty }: { items: { id: string; title: string; sub: string }[]; empty: string }) {
  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '1rem' }}>
      {items.length === 0
        ? <EmptyState icon={<Icon name="homework" size={28} />} title={empty} />
        : items.map(i => (
          <Card key={i.id} pad={false} style={{ marginBottom: '.5rem', padding: '.7rem 1rem' }}>
            <div style={{ fontWeight: 600, fontSize: '.86rem' }}>{i.title}</div>
            <div class="text-xs text-muted">{i.sub}</div>
          </Card>
        ))}
    </div>
  )
}

// ── Grade chip colour ─────────────────────────────────────────────────────────
const GRADE_COLOR: Record<string, { bg: string; fg: string }> = {
  'A+': { bg: '#d1fae5', fg: '#065f46' },
  A:   { bg: '#d1fae5', fg: '#065f46' },
  'B+': { bg: '#dbeafe', fg: '#1e40af' },
  B:   { bg: '#dbeafe', fg: '#1e40af' },
  'C+': { bg: '#fef9c3', fg: '#854d0e' },
  C:   { bg: '#fef9c3', fg: '#854d0e' },
  D:   { bg: 'var(--c-warn-lt)', fg: 'var(--c-warn)' },
  F:   { bg: 'var(--c-accent-lt)', fg: 'var(--c-accent-dk)' },
}
function GradeChip({ grade }: { grade: string }) {
  const tone = GRADE_COLOR[grade] ?? { bg: 'var(--gray-100)', fg: 'var(--gray-600)' }
  return (
    <span style={{ padding: '2px 9px', borderRadius: 9999, fontSize: '.75rem', fontWeight: 700, background: tone.bg, color: tone.fg }}>
      {grade}
    </span>
  )
}

// ── Results / Grade Sheet ─────────────────────────────────────────────────────
function ResultsSection({ studentId }: { studentId: string }) {
  const [sheets, setSheets] = useState<TermResultSheet[] | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    getStudentResults(studentId)
      .then(setSheets)
      .catch(e => setErr(e instanceof Error ? e.message : 'Failed to load results'))
  }, [studentId])

  if (err) return <div class="empty-state" style={{ color: 'var(--c-danger)' }}>{err}</div>
  if (!sheets) return <Spinner label="Loading results…" />

  if (sheets.length === 0) {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '1rem' }}>
        <EmptyState icon={<Icon name="results" size={30} />}
          title="No results yet"
          hint="Results will appear here once your school publishes exam marks." />
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '1rem' }}>
      {sheets.map(sheet => {
        const me = sheet.results[0]
        return (
          <Card key={sheet.exam_term_id} style={{ marginBottom: '1.25rem', padding: 0 }}>
            {/* Term header */}
            <div style={{ padding: '.875rem 1rem .6rem', borderBottom: '1px solid var(--gray-100)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1rem' }}>{sheet.exam_term_name}</div>
                <div class="text-xs text-muted">{me.student_name}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <GradeChip grade={me.grade} />
                {me.percentage != null && (
                  <div class="text-xs text-muted" style={{ marginTop: '3px' }}>
                    {me.percentage.toFixed(1)}% · {me.total_obtained}/{me.total_max}
                  </div>
                )}
              </div>
            </div>

            {/* Subject rows */}
            <div style={{ padding: '.25rem 0' }}>
              {me.subjects.map(s => (
                <div key={s.subject_id} style={{ display: 'flex', alignItems: 'center', padding: '.45rem 1rem', borderBottom: '1px solid var(--gray-50)', gap: '.5rem' }}>
                  <span style={{ flex: 1, fontSize: '.85rem', fontWeight: 500 }}>{s.subject_name}</span>
                  {s.is_absent ? (
                    <span class="badge badge-red">Absent</span>
                  ) : (
                    <>
                      <span style={{ fontSize: '.8rem', color: 'var(--gray-600)', minWidth: 70, textAlign: 'right' }}>
                        {s.marks_obtained != null ? `${s.marks_obtained}/${s.max_marks}` : '—'}
                      </span>
                      <GradeChip grade={s.grade} />
                    </>
                  )}
                </div>
              ))}
            </div>

            {/* Pass/fail footer */}
            <div style={{ padding: '.5rem 1rem', background: me.passed ? 'var(--c-success-lt)' : 'var(--c-accent-lt)', borderRadius: '0 0 var(--r-lg) var(--r-lg)', textAlign: 'center' }}>
              <span style={{ fontSize: '.78rem', fontWeight: 700, color: me.passed ? 'var(--c-success)' : 'var(--c-accent-dk)' }}>
                {me.passed ? 'PASS' : 'NEEDS IMPROVEMENT'}
              </span>
            </div>
          </Card>
        )
      })}
    </div>
  )
}

// ── Parent Portal — big-button launcher ───────────────────────────────────────
type Sec = 'fees' | 'attendance' | 'homework' | 'announcements' | 'timetable' | 'results'
const TILES: { key: Sec; label: string; icon: IconName; desc: string }[] = [
  { key: 'fees',          label: 'Fees',          icon: 'fees',         desc: 'Pay fees and view receipts' },
  { key: 'attendance',    label: 'Attendance',    icon: 'attendance',   desc: 'Daily attendance & absences' },
  { key: 'homework',      label: 'Homework',      icon: 'homework',     desc: 'Assigned homework' },
  { key: 'announcements', label: 'Announcements', icon: 'announcement', desc: 'School & class notices' },
  { key: 'timetable',     label: 'Timetable',     icon: 'timetable',    desc: 'Weekly class schedule' },
  { key: 'results',       label: 'Results',       icon: 'results',      desc: 'Published exam results' },
]

export function ParentPortalView({ onLogout }: { onLogout: () => void }) {
  const [students, setStudents] = useState<LinkedStudent[]>([])
  const [idx, setIdx] = useState(0)
  const [summaries, setSummaries] = useState<Record<string, StudentSummary>>({})
  const [notifs, setNotifs] = useState<ParentNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [section, setSection] = useState<Sec | null>(null)

  useEffect(() => {
    Promise.all([listMyStudents(), listParentNotifications().catch(() => [])])
      .then(async ([ss, ns]) => {
        setStudents(ss); setNotifs(ns)
        const results = await Promise.all(ss.map(s => getStudentSummary(s.id)))
        const map: Record<string, StudentSummary> = {}
        ss.forEach((s, i) => { map[s.id] = results[i] })
        setSummaries(map)
      })
      .catch(e => setErr(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [])

  const student = students[idx]
  const summary = student ? summaries[student.id] : undefined

  function renderSection() {
    if (!student || !summary) return <Spinner />
    switch (section) {
      case 'fees':
        return <FeesSection student={student} schoolName={summary.school_name} upi={summary.school_upi_id} />
      case 'attendance':
        return <AttendanceSection summary={summary} absences={notifs.filter(n => n.type === 'ABSENT')} />
      case 'homework':
        return <FeedSection empty="No homework yet" items={summary.recent_homework.map(h => ({ id: h.id, title: h.title, sub: `${h.subject ?? ''}${h.due_date ? ` · due ${fmtDate(h.due_date)}` : ''}` }))} />
      case 'announcements':
        return <FeedSection empty="No notices yet" items={notifs.map(n => ({ id: n.id, title: n.title, sub: `${n.body} · ${fmtDate(n.created_at)}` }))} />
      case 'results':
        return <ResultsSection studentId={student.id} />
      default:
        return <div style={{ maxWidth: 560, margin: '0 auto', padding: '1rem' }}>
          <EmptyState icon={<Icon name="timetable" size={30} />}
            title="Timetable coming soon"
            hint="Please check with the school office." />
        </div>
    }
  }

  const active = TILES.find(t => t.key === section)

  return (
    <div style={{ minHeight: '100vh', background: 'var(--gray-50)', fontFamily: 'var(--font)' }}>
      <header style={{ background: 'var(--c-primary)', color: '#fff', padding: '0 1.1rem', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100, boxShadow: 'var(--shadow-md)' }}>
        <Brand sub="Parent" color="#fff" onClick={() => setSection(null)} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
          {students.length > 1 && (
            <select value={idx} onChange={e => { setIdx(Number((e.target as HTMLSelectElement).value)); setSection(null) }}
              style={{ background: 'rgba(255,255,255,.14)', color: '#fff', border: '1px solid rgba(255,255,255,.25)', borderRadius: 'var(--r)', padding: '.3rem .5rem', fontSize: '.75rem', fontFamily: 'inherit' }}>
              {students.map((s, i) => <option key={s.id} value={i} style={{ color: '#000' }}>{s.first_name}</option>)}
            </select>
          )}
          <button onClick={onLogout} style={{ background: 'rgba(255,255,255,.14)', color: '#fff', border: '1px solid rgba(255,255,255,.25)', borderRadius: 'var(--r)', padding: '.35rem .8rem', cursor: 'pointer', fontSize: '.75rem', fontFamily: 'inherit', fontWeight: 600 }}>Sign out</button>
        </div>
      </header>

      {loading && <Spinner label="Loading…" />}
      {err && <div class="empty-state" style={{ color: 'var(--c-danger)' }}>{err}</div>}
      {!loading && !err && students.length === 0 && (
        <EmptyState title="No student linked" hint="Contact the school administration." />
      )}

      {!loading && student && summary && (
        section ? (
          <div>
            <div style={{ maxWidth: 560, margin: '0 auto', padding: '.9rem 1rem 0' }}>
              <button onClick={() => setSection(null)} style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-500)', fontFamily: 'inherit', fontSize: '.8rem', padding: 0 }}>
                <Icon name="back" size={16} /> Home <span style={{ color: 'var(--gray-300)' }}>/</span>
                <span style={{ color: 'var(--gray-700)', fontWeight: 600 }}>{active?.label}</span>
              </button>
            </div>
            {renderSection()}
          </div>
        ) : (
          <div style={{ maxWidth: 560, margin: '0 auto', padding: '1.25rem 1rem' }}>
            <h1 style={{ fontSize: '1.3rem' }}>{student.first_name} {student.last_name}</h1>
            <p class="text-sm text-muted" style={{ marginBottom: '1.25rem' }}>
              {student.class_name} {student.section_name} · Roll {student.roll_number} · {summary.school_name}
            </p>
            <div class="tile-grid">
              {TILES.map(t => (
                <SectionTile key={t.key} icon={<Icon name={t.icon} size={24} />} label={t.label} desc={t.desc} onClick={() => setSection(t.key)} />
              ))}
            </div>
          </div>
        )
      )}
    </div>
  )
}
