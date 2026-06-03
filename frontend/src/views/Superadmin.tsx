import { useEffect, useState } from 'preact/hooks'
import { getSuperadminPayments, getSuperadminRevenue } from '../api/finance'
import type { TenantRevenue } from '../types/finance'

function fmt(v: string | number) {
  return `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
}

const STATUS_COLORS: Record<string, string> = { paid: '#065f46', pending: '#92400e', failed: '#991b1b' }
const STATUS_BG: Record<string, string>     = { paid: '#d1fae5', pending: '#fef3c7', failed: '#fee2e2' }

export function SuperadminView() {
  const [revenue, setRevenue] = useState<TenantRevenue[]>([])
  const [payments, setPayments] = useState<Record<string, unknown>[]>([])
  const [tab, setTab] = useState<'revenue' | 'payments'>('revenue')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([getSuperadminRevenue(), getSuperadminPayments(200)])
      .then(([r, p]) => { setRevenue(r); setPayments(p) })
      .finally(() => setLoading(false))
  }, [])

  const totalCollected = revenue.reduce((s, r) => s + Number(r.total_collected), 0)
  const totalOutstanding = revenue.reduce((s, r) => s + Number(r.total_outstanding), 0)
  const totalPayments = revenue.reduce((s, r) => s + r.payment_count, 0)

  const TAB_BTN = (a: boolean): preact.JSX.CSSProperties => ({
    padding: '0.375rem 0.875rem', border: 'none', borderBottom: a ? '2px solid #1a56db' : '2px solid transparent',
    background: 'none', color: a ? '#1a56db' : '#6b7280', cursor: 'pointer', fontSize: '0.875rem', fontWeight: a ? 600 : 400,
  })

  if (loading) return <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>Loading…</div>

  return (
    <div style={{ padding: '1.5rem', fontFamily: 'system-ui, sans-serif' }}>
      <h2 style={{ margin: '0 0 1rem', fontSize: '1.25rem', fontWeight: 700 }}>Superadmin · All Schools</h2>

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {[
          { label: 'Total Collected', value: fmt(totalCollected), color: '#065f46', bg: '#d1fae5' },
          { label: 'Total Outstanding', value: fmt(totalOutstanding), color: '#991b1b', bg: '#fee2e2' },
          { label: 'Schools', value: String(revenue.length), color: '#1e40af', bg: '#dbeafe' },
          { label: 'Payments', value: String(totalPayments), color: '#374151', bg: '#f3f4f6' },
        ].map((c) => (
          <div key={c.label} style={{ padding: '1rem 1.5rem', background: c.bg, borderRadius: 8, minWidth: 160 }}>
            <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}>{c.label}</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 700, color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '1px solid #e5e7eb', marginBottom: '1.25rem' }}>
        <button onClick={() => setTab('revenue')} style={TAB_BTN(tab === 'revenue')}>School Revenue</button>
        <button onClick={() => setTab('payments')} style={TAB_BTN(tab === 'payments')}>All Payments</button>
        <a href="/api/v1/superadmin/payments/export.csv" style={{ marginLeft: 'auto', padding: '0.375rem 0.875rem', color: '#1a56db', textDecoration: 'none', fontSize: '0.8rem', alignSelf: 'center' }}>
          Export CSV ↓
        </a>
      </div>

      {tab === 'revenue' && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ display: 'flex', padding: '0 1rem', height: 36, background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', alignItems: 'center', gap: '1rem' }}>
            <span style={{ flex: 1 }}>SCHOOL</span>
            <span style={{ width: 80 }}>SLUG</span>
            <span style={{ width: 120, textAlign: 'right' }}>COLLECTED</span>
            <span style={{ width: 120, textAlign: 'right' }}>OUTSTANDING</span>
            <span style={{ width: 80, textAlign: 'right' }}>PAYMENTS</span>
          </div>
          {revenue.map((r) => (
            <div key={r.tenant_id} style={{ display: 'flex', padding: '0.625rem 1rem', borderBottom: '1px solid #f3f4f6', gap: '1rem', fontSize: '0.875rem', alignItems: 'center' }}>
              <span style={{ flex: 1, fontWeight: 500 }}>{r.school_name}</span>
              <span style={{ width: 80, color: '#6b7280', fontFamily: 'monospace' }}>{r.slug}</span>
              <span style={{ width: 120, textAlign: 'right', fontWeight: 700, color: '#065f46' }}>{fmt(r.total_collected)}</span>
              <span style={{ width: 120, textAlign: 'right', fontWeight: 700, color: Number(r.total_outstanding) > 0 ? '#dc2626' : '#6b7280' }}>{fmt(r.total_outstanding)}</span>
              <span style={{ width: 80, textAlign: 'right', color: '#6b7280' }}>{r.payment_count}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'payments' && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ display: 'flex', padding: '0 1rem', height: 36, background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ width: 90 }}>SCHOOL</span>
            <span style={{ flex: 1 }}>STUDENT</span>
            <span style={{ width: 110 }}>RECEIPT</span>
            <span style={{ width: 80, textAlign: 'right' }}>AMOUNT</span>
            <span style={{ width: 70 }}>STATUS</span>
            <span style={{ width: 90 }}>DATE</span>
          </div>
          {payments.length === 0 && <p style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af', fontSize: '0.875rem' }}>No payments yet.</p>}
          {payments.map((p: any) => (
            <div key={p.id} style={{ display: 'flex', padding: '0.5rem 1rem', borderBottom: '1px solid #f3f4f6', gap: '0.75rem', fontSize: '0.8rem', alignItems: 'center' }}>
              <span style={{ width: 90, color: '#6b7280', fontFamily: 'monospace' }}>{p.tenant_slug}</span>
              <span style={{ flex: 1 }}>{p.student_name}</span>
              <span style={{ width: 110, fontWeight: p.receipt_number ? 600 : 400, color: p.receipt_number ? '#1a56db' : '#9ca3af' }}>{p.receipt_number ?? '—'}</span>
              <span style={{ width: 80, textAlign: 'right', fontWeight: 700 }}>{fmt(p.amount)}</span>
              <span style={{ width: 70 }}>
                <span style={{ padding: '2px 6px', background: STATUS_BG[p.status] ?? '#f3f4f6', color: STATUS_COLORS[p.status] ?? '#374151', borderRadius: 9999, fontSize: '0.7rem', fontWeight: 600 }}>{p.status}</span>
              </span>
              <span style={{ width: 90, color: '#6b7280' }}>{p.paid_at ? new Date(p.paid_at).toLocaleDateString('en-IN') : '—'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
