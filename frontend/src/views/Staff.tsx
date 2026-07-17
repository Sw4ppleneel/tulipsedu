import { useEffect, useState } from 'preact/hooks'
import { VirtualList } from '../components/VirtualList'
import { useIsMobile } from '../hooks/useIsMobile'
import { listStaff, assignStaffRole, resetStaffPassword } from '../api/staff'
import { StaffForm } from './StaffForm'
import { ExcelImport } from '../ui'
import type { Staff, StaffRole } from '../types/staff'
import { STAFF_ROLES } from '../types/staff'

const ROLE_LABELS: Record<StaffRole, string> = {
  principal: 'Principal',
  vice_principal: 'Vice Principal',
  class_teacher: 'Class Teacher',
  teacher: 'Teacher',
  accountant: 'Accountant',
}

function AccessModal({ member, onClose, onDone }: { member: Staff; onClose: () => void; onDone: () => void }) {
  const [role, setRole] = useState<StaffRole>('teacher')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ password: string } | null>(null)

  const [newPassword, setNewPassword] = useState('')
  const [resettingPw, setResettingPw] = useState(false)
  const [pwError, setPwError] = useState('')
  const [pwDone, setPwDone] = useState(false)

  async function save() {
    setSaving(true); setError('')
    try {
      const res = await assignStaffRole(member.id, role)
      if (res.login_created && res.generated_password) {
        setResult({ password: res.generated_password })
      } else {
        onDone()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to assign role')
    } finally {
      setSaving(false)
    }
  }

  async function resetPassword() {
    setPwError(''); setPwDone(false)
    if (newPassword.length < 6) { setPwError('Must be at least 6 characters'); return }
    setResettingPw(true)
    try {
      await resetStaffPassword(member.id, newPassword)
      setPwDone(true)
      setNewPassword('')
    } catch (e) {
      setPwError(e instanceof Error ? e.message : 'Failed to reset password')
    } finally {
      setResettingPw(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 8, padding: '1.5rem', width: 360, maxWidth: '90vw' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 0.25rem', fontSize: '1rem', fontWeight: 600 }}>Manage Access</h3>
        <p style={{ margin: '0 0 1rem', fontSize: '0.8rem', color: '#6b7280' }}>{member.first_name} {member.last_name}</p>

        {result ? (
          <>
            <p style={{ fontSize: '0.8rem', color: '#374151', lineHeight: 1.6 }}>
              Login created. Share these credentials with {member.first_name}:
            </p>
            <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: '0.75rem', fontSize: '0.8rem', fontFamily: 'monospace', marginBottom: '1rem' }}>
              <div>Username: {member.phone_number}</div>
              <div>Password: {result.password}</div>
            </div>
            <button
              onClick={() => { onDone() }}
              style={{ padding: '0.5rem 1rem', background: '#14463A', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem' }}
            >
              Done
            </button>
          </>
        ) : (
          <>
            {error && <p style={{ color: '#c00', fontSize: '0.8rem', marginBottom: '0.75rem' }}>{error}</p>}
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#555', marginBottom: '0.25rem' }}>Role</label>
            <select
              value={role}
              onChange={(e) => setRole((e.target as HTMLSelectElement).value as StaffRole)}
              style={{ width: '100%', padding: '0.5rem', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.875rem', marginBottom: '1rem' }}
            >
              {STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
            {!member.user_id && (
              <p style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '1rem' }}>
                No login yet — one will be created (username = phone number, password auto-generated).
              </p>
            )}
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={save}
                disabled={saving}
                style={{ padding: '0.5rem 1rem', background: '#14463A', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem' }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={onClose}
                style={{ padding: '0.5rem 1rem', background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem' }}
              >
                Cancel
              </button>
            </div>

            {member.user_id && (
              <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid #e5e7eb' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', color: '#555', marginBottom: '0.25rem' }}>Reset Password</label>
                <p style={{ fontSize: '0.72rem', color: '#9ca3af', margin: '0 0 0.5rem' }}>
                  Overrides their current password directly — no need to know the old one.
                </p>
                {pwError && <p style={{ color: '#c00', fontSize: '0.78rem', marginBottom: '0.5rem' }}>{pwError}</p>}
                {pwDone && <p style={{ color: '#0D332A', fontSize: '0.78rem', marginBottom: '0.5rem' }}>✓ Password updated.</p>}
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="text"
                    value={newPassword}
                    onInput={(e) => setNewPassword((e.target as HTMLInputElement).value)}
                    placeholder="New password (min. 6 chars)"
                    style={{ flex: 1, padding: '0.5rem', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.875rem' }}
                  />
                  <button
                    onClick={resetPassword}
                    disabled={resettingPw || !newPassword}
                    style={{ padding: '0.5rem 0.9rem', background: '#374151', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                  >
                    {resettingPw ? 'Setting…' : 'Set Password'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

const ROW_H = 52
const ROW_H_MOBILE = 92
const LIST_H = 520

function LoginPill() {
  return (
    <span style={{ padding: '2px 7px', background: '#d1fae5', color: '#0D332A', borderRadius: 9999, fontSize: '0.7rem', fontWeight: 600 }}>
      Login
    </span>
  )
}

function ManageAccessButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick} title="Manage access"
      style={{
        padding: '2px 9px', borderRadius: 9999, fontSize: '0.68rem', fontWeight: 600,
        cursor: 'pointer', fontFamily: 'inherit', border: '1px solid var(--gray-300)',
        background: 'transparent', color: 'var(--gray-400)', whiteSpace: 'nowrap',
      }}
    >
      Manage Access
    </button>
  )
}

function StaffRow({ member, mobile, canManageAccess, onManageAccess }: {
  member: Staff
  mobile: boolean
  canManageAccess: boolean
  onManageAccess: (member: Staff) => void
}) {
  if (mobile) {
    return (
      <div style={{
        height: ROW_H_MOBILE, display: 'flex', flexDirection: 'column',
        justifyContent: 'center', gap: '0.3rem', padding: '0.5rem 0.9rem',
        borderBottom: '1px solid #f3f4f6', background: '#fff', fontSize: '0.8rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', minWidth: 0 }}>
          <span style={{ fontWeight: 700, color: '#14463A', flexShrink: 0 }}>{member.employee_no}</span>
          <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {member.first_name} {member.last_name}
          </span>
          {member.user_id && <span style={{ marginLeft: 'auto', flexShrink: 0 }}><LoginPill /></span>}
        </div>
        <div style={{ color: '#6b7280', fontSize: '0.72rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          <span>{member.designation}</span><span aria-hidden>·</span>
          <span>{member.department ?? '—'}</span><span aria-hidden>·</span>
          <span>{member.phone_number}</span>
        </div>
        {canManageAccess && (
          <div><ManageAccessButton onClick={() => onManageAccess(member)} /></div>
        )}
      </div>
    )
  }

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
      <span style={{ width: 80, flexShrink: 0 }}>
        {member.user_id && <LoginPill />}
      </span>
      <span style={{ width: 116, textAlign: 'right', flexShrink: 0 }}>
        {canManageAccess && <ManageAccessButton onClick={() => onManageAccess(member)} />}
      </span>
    </div>
  )
}

function TableHeader({ showAccessCol }: { showAccessCol: boolean }) {
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
      {showAccessCol && <span style={{ width: 116, flexShrink: 0 }}></span>}
    </div>
  )
}

export function StaffView({ role }: { role?: string } = {}) {
  const isMobile = useIsMobile()
  const rowHeight = isMobile ? ROW_H_MOBILE : ROW_H
  const listHeight = isMobile ? 600 : LIST_H
  const canManageAccess = role === 'principal'
  const [accessTarget, setAccessTarget] = useState<Staff | null>(null)
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
    <div style={{ padding: isMobile ? '1rem 0.75rem' : '1.5rem', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: '.5rem', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>Staff</h2>
          {!loading && <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: '#6b7280' }}>{total} member{total !== 1 ? 's' : ''}</p>}
        </div>
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
          <ExcelImport
            endpoint="/staff/import"
            columns="Employee No, First Name, Last Name, Phone, Designation, Date of Joining"
            onImported={load}
          />
          <button
            onClick={() => setShowForm(true)}
            style={{ padding: '0.5rem 1rem', background: '#14463A', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem', fontWeight: 500 }}
          >
            + Add Staff
          </button>
        </div>
      </div>

      {showForm && (
        <StaffForm
          onCreated={() => { setShowForm(false); load() }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {accessTarget && (
        <AccessModal
          member={accessTarget}
          onClose={() => setAccessTarget(null)}
          onDone={() => { setAccessTarget(null); load() }}
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
          {!isMobile && <TableHeader showAccessCol={canManageAccess} />}
          {visible.length > 50 ? (
            <VirtualList
              items={visible}
              rowHeight={rowHeight}
              containerHeight={listHeight}
              keyFn={(s) => s.id}
              renderRow={(s) => <StaffRow member={s} mobile={isMobile} canManageAccess={canManageAccess} onManageAccess={setAccessTarget} />}
            />
          ) : (
            <div>{visible.map((s) => <StaffRow key={s.id} member={s} mobile={isMobile} canManageAccess={canManageAccess} onManageAccess={setAccessTarget} />)}</div>
          )}
        </div>
      )}
    </div>
  )
}
