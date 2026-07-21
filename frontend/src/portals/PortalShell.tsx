import { useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { Brand, PasswordInput, SectionTile } from '../ui'
import { changePassword } from '../api/client'
import { usePwaInstall } from '../hooks/usePwaInstall'
import { NotificationsBell } from '../views/NotificationsBell'
import { ROLE_LABELS } from '../types/staff'

// Self-service password change, available to every staff role from the
// shared header — not a per-portal section, so it lives here once.
function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [saving, setSaving] = useState(false)

  async function submit(e: Event) {
    e.preventDefault()
    setError('')
    if (next.length < 6) { setError('New password must be at least 6 characters'); return }
    if (next !== confirm) { setError("New passwords don't match"); return }
    setSaving(true)
    try {
      await changePassword(current, next)
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500, padding: '1rem' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 'var(--r)', padding: '1.5rem', width: '100%', maxWidth: 360 }}>
        <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', fontFamily: 'var(--font-display)' }}>Change Password</h3>
        {done ? (
          <>
            <p class="text-sm" style={{ color: 'var(--c-success)', marginBottom: '1rem' }}>✓ Password changed.</p>
            <button class="btn btn-primary" style={{ width: '100%' }} onClick={onClose}>Done</button>
          </>
        ) : (
          <form onSubmit={submit}>
            {error && <div class="err" style={{ marginBottom: '.75rem' }}>{error}</div>}
            <PasswordInput value={current} onInput={setCurrent} placeholder="Current password" required autocomplete="current-password" />
            <div style={{ height: '.6rem' }} />
            <PasswordInput value={next} onInput={setNext} placeholder="New password (min. 6 characters)" required autocomplete="new-password" />
            <div style={{ height: '.6rem' }} />
            <PasswordInput value={confirm} onInput={setConfirm} placeholder="Confirm new password" required autocomplete="new-password" />
            <div style={{ display: 'flex', gap: '.6rem', marginTop: '1rem' }}>
              <button type="submit" class="btn btn-primary" disabled={saving} style={{ flex: 1 }}>{saving ? 'Saving…' : 'Change Password'}</button>
              <button type="button" onClick={onClose} class="btn btn-ghost">Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

// A portal section = one big launcher tile + the dedicated page it opens.
export interface PortalSection {
  key: string
  label: string
  icon: ComponentChildren
  desc?: string
  render: (navigate: (key: string) => void) => ComponentChildren
}

export interface PortalConfig {
  /** Short portal name shown under the wordmark, e.g. "Principal". */
  name: string
  /** Tenant/school name, shown when no portal-specific subtitle is needed. */
  schoolName?: string
  /** Staff member's first name for the home screen greeting. */
  staffName?: string
  sections: PortalSection[]
  /** Staff portals show the notifications bell; parent uses its own surface. */
  showBell?: boolean
  /** Optional tenant logo asset path (no placeholder/generated logo otherwise). */
  logoUrl?: string | null
  onLogout: () => void
  /** All roles this login holds, and a way to switch which one's portal is
   * displayed. Purely client-side UI state — never sent to the backend as
   * a scoping parameter. Only rendered when there's more than one role. */
  allRoles?: string[]
  activeRole?: string
  onSwitchRole?: (role: string) => void
}

/**
 * Shared chrome for every staff portal. Startup shows the big-button launcher
 * (PortalHome); selecting a tile opens that section's dedicated page with a
 * back-to-home breadcrumb. Same design system across all roles — only the
 * section set differs, so every screen reads as the same Tulips.edu product.
 */
export function PortalShell({ config }: { config: PortalConfig }) {
  const [active, setActive] = useState<string | null>(null)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const current = config.sections.find(s => s.key === active) ?? null
  const { isInstallable, triggerInstall } = usePwaInstall()

  return (
    <div style={{ minHeight: '100vh', background: 'var(--gray-50)', fontFamily: 'var(--font)' }}>
      <header style={{
        background: 'var(--c-primary)', color: '#fff', padding: '0 1.25rem', height: 56,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 100, boxShadow: 'var(--shadow-md)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', minWidth: 0 }}>
          <Brand sub={config.name} logoUrl={config.logoUrl} color="#fff" onClick={() => setActive(null)} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexShrink: 0 }}>
          {config.allRoles && config.allRoles.length > 1 && config.onSwitchRole && (
            <select
              value={config.activeRole}
              onChange={e => config.onSwitchRole!((e.target as HTMLSelectElement).value)}
              title="Switch role"
              style={{ background: 'rgba(255,255,255,.14)', color: '#fff', border: '1px solid rgba(255,255,255,.25)', borderRadius: 'var(--r)', padding: '.35rem .6rem', cursor: 'pointer', fontSize: '.75rem', fontFamily: 'inherit', fontWeight: 600 }}
            >
              {config.allRoles.map(r => (
                <option key={r} value={r} style={{ color: '#000' }}>{ROLE_LABELS[r] ?? r}</option>
              ))}
            </select>
          )}
          {config.showBell && <NotificationsBell />}
          {isInstallable && (
            <button
              onClick={triggerInstall}
              style={{ background: 'rgba(255,255,255,.14)', color: '#fff', border: '1px solid rgba(255,255,255,.25)', borderRadius: 'var(--r)', padding: '.35rem .8rem', cursor: 'pointer', fontSize: '.75rem', fontFamily: 'inherit', fontWeight: 600 }}
            >
              Install App
            </button>
          )}
          <button
            onClick={() => setShowChangePassword(true)}
            style={{ background: 'rgba(255,255,255,.14)', color: '#fff', border: '1px solid rgba(255,255,255,.25)', borderRadius: 'var(--r)', padding: '.35rem .8rem', cursor: 'pointer', fontSize: '.75rem', fontFamily: 'inherit', fontWeight: 600 }}
          >
            Change Password
          </button>
          <button
            onClick={config.onLogout}
            style={{ background: 'rgba(255,255,255,.14)', color: '#fff', border: '1px solid rgba(255,255,255,.25)', borderRadius: 'var(--r)', padding: '.35rem .8rem', cursor: 'pointer', fontSize: '.75rem', fontFamily: 'inherit', fontWeight: 600 }}
          >
            Sign out
          </button>
        </div>
      </header>

      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}

      <main>
        {current ? (
          <div>
            <div style={{ maxWidth: 1080, margin: '0 auto', padding: '.9rem 1.25rem 0' }}>
              <button
                onClick={() => setActive(null)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-500)', fontFamily: 'inherit', fontSize: '.8rem', padding: 0 }}
              >
                ← {config.name} home <span style={{ color: 'var(--gray-300)' }}>/</span>
                <span style={{ color: 'var(--gray-700)', fontWeight: 600 }}>{current.label}</span>
              </button>
            </div>
            {current.render(setActive)}
          </div>
        ) : (
          <PortalHome config={config} onOpen={setActive} />
        )}
      </main>
    </div>
  )
}

function PortalHome({ config, onOpen }: { config: PortalConfig; onOpen: (k: string) => void }) {
  const greeting = config.staffName ? `Hi, ${config.staffName}` : 'Welcome'
  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '1.75rem 1.25rem' }}>
      <p style={{ margin: '0 0 .1rem', fontSize: '.85rem', color: 'var(--gray-500)', fontWeight: 500 }}>
        {config.schoolName || 'Tulips.edu'}
      </p>
      <h1 style={{ fontSize: '1.6rem', margin: '0 0 .25rem', fontFamily: 'var(--font-display)', color: 'var(--gray-900)' }}>
        {greeting}
      </h1>
      <p style={{ color: 'var(--gray-500)', marginBottom: '1.5rem', fontSize: '.875rem' }}>
        {config.name} workspace — choose a section to begin.
      </p>
      <div class="tile-grid">
        {config.sections.map(s => (
          <SectionTile
            key={s.key}
            icon={s.icon}
            label={s.label}
            desc={s.desc}
            onClick={() => onOpen(s.key)}
          />
        ))}
      </div>
    </div>
  )
}
