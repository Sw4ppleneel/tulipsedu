/**
 * Tulips.edu shared UI primitives.
 *
 * One component library for every portal — built only from the design tokens in
 * globals.css (the landing page is the source of truth). No Material/Bootstrap/
 * Ant/shadcn/Daisy. Reuse these instead of re-implementing visual variations.
 */
import type { ComponentChildren, JSX } from 'preact'
export { Icon, type IconName } from './icons'

// ── Brand wordmark ───────────────────────────────────────────────────────────
// Logo policy: no placeholder image and no generated logo. Render a text wordmark
// by default; if a tenant configures a logo asset path, render that image instead.
// Swappable without code changes via the `logoUrl` prop (wired from tenant settings).
export function Brand({
  sub, logoUrl, onClick, color = 'currentColor',
}: {
  sub?: string
  logoUrl?: string | null
  onClick?: () => void
  color?: string
}) {
  return (
    <div
      class="brand"
      onClick={onClick}
      style={{ color, cursor: onClick ? 'pointer' : 'default', lineHeight: 1.1 }}
    >
      {logoUrl
        ? <img src={logoUrl} alt="" style={{ height: 26, width: 'auto', display: 'block' }} />
        : <span class="brand-dot" aria-hidden="true" />}
      <span style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: '1.05rem', fontWeight: 700 }}>Tulips.edu</span>
        {sub && <span style={{ fontSize: '.62rem', opacity: .8, fontWeight: 500, fontFamily: 'var(--font)' }}>{sub}</span>}
      </span>
    </div>
  )
}

// ── Button ───────────────────────────────────────────────────────────────────
type BtnVariant = 'primary' | 'accent' | 'ghost' | 'danger'
type BtnSize = 'sm' | 'md' | 'lg'

export function Button({
  variant = 'primary', size = 'md', children, ...rest
}: {
  variant?: BtnVariant
  size?: BtnSize
  children: ComponentChildren
} & JSX.HTMLAttributes<HTMLButtonElement>) {
  const cls = ['btn', `btn-${variant}`, size !== 'md' ? `btn-${size}` : '']
    .filter(Boolean).join(' ')
  return <button {...rest} class={`${cls} ${rest.class ?? ''}`.trim()}>{children}</button>
}

// ── Card ─────────────────────────────────────────────────────────────────────
export function Card({
  pad = true, children, style, ...rest
}: {
  pad?: boolean
  children: ComponentChildren
} & JSX.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} class={`card ${pad ? 'card-pad' : ''} ${rest.class ?? ''}`.trim()} style={style}>
      {children}
    </div>
  )
}

// ── Badge ────────────────────────────────────────────────────────────────────
type BadgeTone = 'blue' | 'green' | 'yellow' | 'red' | 'gray' | 'purple'
export function Badge({ tone = 'gray', children }: { tone?: BadgeTone; children: ComponentChildren }) {
  return <span class={`badge badge-${tone}`}>{children}</span>
}

// ── Section tile (big launcher button) ───────────────────────────────────────
export function SectionTile({
  icon, label, desc, badge, onClick,
}: {
  icon: ComponentChildren
  label: string
  desc?: string
  badge?: ComponentChildren
  onClick: () => void
}) {
  return (
    <button class="tile" onClick={onClick} type="button">
      <span class="tile-icon" aria-hidden="true">{icon}</span>
      <span class="tile-label">{label}</span>
      {desc && <span class="tile-desc">{desc}</span>}
      {badge && <span class="tile-badge">{badge}</span>}
    </button>
  )
}

// ── States ───────────────────────────────────────────────────────────────────
export function Spinner({ label }: { label?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.6rem', padding: '3rem 1rem', color: 'var(--gray-500)' }}>
      <span class="spinner" />
      {label && <span style={{ fontSize: '.8rem' }}>{label}</span>}
    </div>
  )
}

export function EmptyState({
  icon = '◦', title, hint,
}: { icon?: ComponentChildren; title: string; hint?: string }) {
  return (
    <div class="empty-state" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.4rem' }}>
      <div style={{ fontSize: '2rem', opacity: .5 }}>{icon}</div>
      <div style={{ fontWeight: 600, color: 'var(--gray-600)', fontFamily: 'var(--font-display)' }}>{title}</div>
      {hint && <div style={{ fontSize: '.78rem' }}>{hint}</div>}
    </div>
  )
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div class="empty-state" style={{ color: 'var(--c-danger)' }}>
      <div style={{ fontSize: '1.5rem', marginBottom: '.3rem' }}>⚠</div>
      {message}
    </div>
  )
}
