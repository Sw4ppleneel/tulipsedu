import { useEffect, useState } from 'preact/hooks'
import { listPendingPayments, approvePayment, rejectPayment, downloadReceiptPdf, type PendingPayment } from '../api/finance'
import { Card, Button, Icon, Spinner, EmptyState } from '../ui'

const inr = (n: number) => '₹' + Number(n).toLocaleString('en-IN')

// A payment that was just approved this session — kept so staff can grab the PDF.
interface PaidRow extends PendingPayment { receipt_number: string }

// Accountant queue for parent-reported UPI payments: cross-check the UTR/amount
// against the bank statement, then approve (→ receipt) or reject (→ parent told).
export function PaymentVerificationView() {
  const [rows, setRows] = useState<PendingPayment[] | null>(null)
  const [paid, setPaid] = useState<PaidRow[]>([])
  const [busy, setBusy] = useState<string>('')
  const [err, setErr] = useState('')

  async function load() {
    try { setRows(await listPendingPayments()) } catch (e) { setErr(e instanceof Error ? e.message : 'Failed') }
  }
  useEffect(() => { load() }, [])

  async function approve(id: string) {
    setBusy(id); setErr('')
    try {
      const res = await approvePayment(id)
      const row = (rows ?? []).find(x => x.id === id)
      setRows(r => (r ?? []).filter(x => x.id !== id))
      if (row) setPaid(p => [{ ...row, receipt_number: res.receipt_number }, ...p])
    }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed') } finally { setBusy('') }
  }
  async function downloadPdf(id: string, receiptNumber: string) {
    setBusy(id); setErr('')
    try { await downloadReceiptPdf(id, receiptNumber) }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not generate receipt PDF') } finally { setBusy('') }
  }
  async function reject(id: string) {
    const reason = prompt('Reason for rejecting this payment? (the parent will see this)')
    if (reason === null) return
    setBusy(id); setErr('')
    try { await rejectPayment(id, reason); setRows(r => (r ?? []).filter(x => x.id !== id)) }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed') } finally { setBusy('') }
  }

  if (!rows) return <Spinner label="Loading queue…" />

  return (
    <div class="page" style={{ maxWidth: 760 }}>
      <div class="page-hd">
        <div class="page-title">Verify Payments</div>
        <span class="text-sm text-muted">{rows.length} awaiting approval</span>
      </div>
      {err && <div class="err" style={{ marginBottom: '.75rem' }}>{err}</div>}

      {rows.length === 0 ? (
        <EmptyState icon={<Icon name="fees" size={32} />} title="Nothing to verify"
          hint="Parent-reported UPI payments appear here for approval." />
      ) : rows.map(r => (
        <Card key={r.id} style={{ marginBottom: '.75rem' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '.75rem' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontFamily: 'var(--font-display)' }}>
                {r.first_name} {r.last_name} <span class="text-xs text-muted">· {r.class_name} {r.section_name} · {r.admission_no}</span>
              </div>
              <div class="text-sm" style={{ marginTop: '.15rem' }}>
                <b>{inr(r.amount)}</b> · {r.periods || '—'}
              </div>
              <div class="text-xs text-muted">
                {r.reference_no ? <>UTR <b style={{ color: 'var(--gray-700)' }}>{r.reference_no}</b> · </> : 'No UTR provided · '}
                claimed {new Date(r.created_at).toLocaleString('en-IN')}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '.5rem', flexShrink: 0 }}>
              <Button variant="ghost" size="sm" disabled={busy === r.id} onClick={() => reject(r.id)}>Reject</Button>
              <Button variant="primary" size="sm" disabled={busy === r.id} onClick={() => approve(r.id)}>
                {busy === r.id ? '…' : 'Approve'}
              </Button>
            </div>
          </div>
        </Card>
      ))}

      <p class="text-xs text-muted" style={{ marginTop: '1rem' }}>
        Approve only after confirming the amount (and UTR, if given) against the school bank account.
      </p>

      {paid.length > 0 && (
        <>
          <div class="page-hd" style={{ marginTop: '2rem' }}>
            <div class="page-title" style={{ fontSize: '1.05rem' }}>Paid · receipt ready</div>
            <span class="text-sm text-muted">{paid.length} approved just now</span>
          </div>
          {paid.map(r => (
            <Card key={r.id} style={{ marginBottom: '.75rem', borderLeft: '3px solid var(--c-success)' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '.75rem' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontFamily: 'var(--font-display)' }}>
                    {r.first_name} {r.last_name} <span class="text-xs text-muted">· {r.class_name} {r.section_name} · {r.admission_no}</span>
                  </div>
                  <div class="text-sm" style={{ marginTop: '.15rem' }}><b>{inr(r.amount)}</b> · {r.periods || '—'}</div>
                  <div class="text-xs text-muted">Receipt <b style={{ color: 'var(--gray-700)' }}>{r.receipt_number}</b></div>
                </div>
                <Button variant="primary" size="sm" disabled={busy === r.id} onClick={() => downloadPdf(r.id, r.receipt_number)}>
                  {busy === r.id ? '…' : 'Download receipt (PDF)'}
                </Button>
              </div>
            </Card>
          ))}
          <p class="text-xs text-muted" style={{ marginTop: '.5rem' }}>
            Download the PDF and forward it to the parent on WhatsApp or email.
          </p>
        </>
      )}
    </div>
  )
}
