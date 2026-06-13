import { useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { Brand, SectionTile } from '../ui'
import { NotificationsBell } from '../views/NotificationsBell'

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
  sections: PortalSection[]
  /** Staff portals show the notifications bell; parent uses its own surface. */
  showBell?: boolean
  /** Optional tenant logo asset path (no placeholder/generated logo otherwise). */
  logoUrl?: string | null
  onLogout: () => void
}

/**
 * Shared chrome for every staff portal. Startup shows the big-button launcher
 * (PortalHome); selecting a tile opens that section's dedicated page with a
 * back-to-home breadcrumb. Same design system across all roles — only the
 * section set differs, so every screen reads as the same Tulips.edu product.
 */
export function PortalShell({ config }: { config: PortalConfig }) {
  const [active, setActive] = useState<string | null>(null)
  const current = config.sections.find(s => s.key === active) ?? null

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
          {config.showBell && <NotificationsBell />}
          <button
            onClick={config.onLogout}
            style={{ background: 'rgba(255,255,255,.14)', color: '#fff', border: '1px solid rgba(255,255,255,.25)', borderRadius: 'var(--r)', padding: '.35rem .8rem', cursor: 'pointer', fontSize: '.75rem', fontFamily: 'inherit', fontWeight: 600 }}
          >
            Sign out
          </button>
        </div>
      </header>

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
  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '1.75rem 1.25rem' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '.25rem' }}>
        {config.schoolName || 'Tulips.edu'}
      </h1>
      <p style={{ color: 'var(--gray-500)', marginBottom: '1.5rem', fontSize: '.9rem' }}>
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
