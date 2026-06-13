import { useEffect, useState } from 'preact/hooks'
import { VirtualList } from '../components/VirtualList'
import { listStaff } from '../api/staff'
import { StaffForm } from './StaffForm'
import type { Staff } from '../types/staff'

const ROW_H = 52
const LIST_H = 520

function StaffRow({ member }: { member: Staff }) {
  return (
    <div style={{
      height: ROW_H, display: 'flex', alignItems: 'center',
      padding: '0 1rem', borderBottom: '1px solid #f3f4f6',
      gap: '0.75rem', fontSize: '0.8rem', background: '#fff',
    }}>
      <span style={{ width: 80, fontWeight: 700, color: '#14463A', flexShrink: 0 }}>{member.employee_no}</span>
      <span style={{ flex: 1, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {member.first_name} {member.last_name}
      </span>
      <span style={{ width: 150, color: '#374151', flexShrink: 0 }}>{member.designation}</span>
      <span style={{ width: 130, color: '#6b7280', flexShrink: 0 }}>{member.department ?? '—'}</span>
      <span style={{ width: 110, color: '#6b7280', flexShrink: 0 }}>{member.phone_number}</span>
      <span style={{ width: 80, textAlign: 'right', flexShrink: 0 }}>
        {member.user_id && (
          <span style={{ padding: '2px 7px', background: '#d1fae5', color: '#0D332A', borderRadius: 9999, fontSize: '0.7rem', fontWeight: 600 }}>
            Login
          </span>
        )}
      </span>
    </div>
  )
}

function TableHeader() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', padding: '0 1rem',
      height: 36, background: '#f9fafb', borderBottom: '1px solid #e5e7eb',
      fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', gap: '0.75rem',
    }}>
      <span style={{ width: 80, flexShrink: 0 }}>EMP NO</span>
      <span style={{ flex: 1 }}>NAME</span>
      <span style={{ width: 150, flexShrink: 0 }}>DESIGNATION</span>
      <span style={{ width: 130, flexShrink: 0 }}>DEPARTMENT</span>
      <span style={{ width: 110, flexShrink: 0 }}>PHONE</span>
      <span style={{ width: 80, flexShrink: 0 }}></span>
    </div>
  )
}

export function StaffView() {
  const [staff, setStaff] = useState<Staff[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [filter, setFilter] = useState('')
  const [error, setError] = useState('')

  function load() {
    setLoading(true)
    listStaff({ limit: 500 })
      .then((r) => { setStaff(r.items); setTotal(r.total) })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const visible = filter
    ? staff.filter((s) =>
        `${s.first_name} ${s.last_name} ${s.designation} ${s.employee_no}`
          .toLowerCase()
          .includes(filter.toLowerCase()),
      )
    : staff

  const SEL: preact.JSX.CSSProperties = { padding: '0.375rem 0.625rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.8rem' }

  return (
    <div style={{ padding: '1.5rem', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>Staff</h2>
          {!loading && <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: '#6b7280' }}>{total} member{total !== 1 ? 's' : ''}</p>}
        </div>
        <button
          onClick={() => setShowForm(true)}
          style={{ padding: '0.5rem 1rem', background: '#14463A', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem', fontWeight: 500 }}
        >
          + Add Staff
        </button>
      </div>

      {showForm && (
        <StaffForm
          onCreated={() => { setShowForm(false); load() }}
          onCancel={() => setShowForm(false)}
        />
      )}

      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.875rem' }}>
        <input
          value={filter}
          onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
          placeholder="Search by name, designation…"
          style={{ ...SEL, flex: 1, maxWidth: 320 }}
        />
      </div>

      {error && <p style={{ color: '#c00', fontSize: '0.875rem' }}>{error}</p>}

      {loading ? (
        <p style={{ color: '#9ca3af', fontSize: '0.875rem' }}>Loading…</p>
      ) : visible.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: '#9ca3af', fontSize: '0.875rem', background: '#f9fafb', borderRadius: 8 }}>
          No staff found. Click <strong>+ Add Staff</strong> to begin.
        </div>
      ) : (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <TableHeader />
          {visible.length > 50 ? (
            <VirtualList
              items={visible}
              rowHeight={ROW_H}
              containerHeight={LIST_H}
              keyFn={(s) => s.id}
              renderRow={(s) => <StaffRow member={s} />}
            />
          ) : (
            <div>{visible.map((s) => <StaffRow key={s.id} member={s} />)}</div>
          )}
        </div>
      )}
    </div>
  )
}
