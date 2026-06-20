import { useEffect, useState } from 'preact/hooks'
import { cmsPublic } from '../../api/cms'
import type { CmsAnnouncement } from '../../api/cms'
import { schoolAsset, schoolSlug } from '../../assets'
import { AdmissionForm } from './AdmissionForm'

// ── Palette — drawn from the school: navy & gold (sign board), rose & maroon (building) ──
const C = {
  navy:    '#1C2B4A',
  navyDk:  '#101A2E',
  gold:    '#C9A227',
  goldLt:  '#E6C45A',
  maroon:  '#9B4A3F',
  rose:    '#E3B2A4',
  roseDk:  '#C98B7C',
  cream:   '#FBF1ED',
  creamDk: '#F0DDD5',
  white:   '#FFFFFF',
  gray500: '#6B7280',
  gray600: '#4B5563',
  gray400: '#9CA3AF',
  gray900: '#111827',
}

const FONT = "'Segoe UI', system-ui, -apple-system, sans-serif"

// ── Vector icon set (no emojis) ───────────────────────────────────────────────
type IcoName =
  | 'target' | 'star' | 'heart' | 'monitor' | 'book' | 'pencil' | 'flask'
  | 'trophy' | 'palette' | 'bus' | 'sprout' | 'building' | 'cap'
  | 'mapPin' | 'phone' | 'mail' | 'clock' | 'users' | 'megaphone'
  | 'arrowRight' | 'image' | 'externalLink'

function Ico({ name, size = 24, stroke = 'currentColor', width = 1.6 }: { name: IcoName; size?: number; stroke?: string; width?: number }) {
  const p = (() => {
    switch (name) {
      case 'target': return <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.4" /></>
      case 'star': return <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 17l-5.2 2.6 1-5.8-4.3-4.1 5.9-.9z" />
      case 'heart': return <path d="M12 20.5S4 14.5 4 9a4 4 0 0 1 8-1 4 4 0 0 1 8 1c0 5.5-8 11.5-8 11.5z" />
      case 'monitor': return <><rect x="3" y="4" width="18" height="12" rx="2" /><line x1="8.5" y1="20" x2="15.5" y2="20" /><line x1="12" y1="16" x2="12" y2="20" /></>
      case 'book': return <><path d="M12 6.5C10.5 5.3 8.4 4.6 5.6 4.6c-.6 0-1 .4-1 1V18c0 .6.5 1 1 1 2.8 0 4.9.7 6.4 1.9 1.5-1.2 3.6-1.9 6.4-1.9.6 0 1-.4 1-1V5.6c0-.6-.4-1-1-1-2.8 0-4.9.7-6.4 1.9z" /><line x1="12" y1="6.5" x2="12" y2="20.5" /></>
      case 'pencil': return <><path d="M5 19l1-4L16.5 4.5a1.5 1.5 0 0 1 2.1 0l.9.9a1.5 1.5 0 0 1 0 2.1L9 18l-4 1z" /><line x1="14.5" y1="6.5" x2="17.5" y2="9.5" /></>
      case 'flask': return <><path d="M9.5 3h5" /><path d="M10.5 3v5.5L5.8 17a1.5 1.5 0 0 0 1.3 2.3h9.8a1.5 1.5 0 0 0 1.3-2.3L13.5 8.5V3" /><line x1="8" y1="14.5" x2="16" y2="14.5" /></>
      case 'trophy': return <><path d="M8 4h8v4a4 4 0 0 1-8 0z" /><path d="M8 5H5.5a2 2 0 0 0 0 4H8.5" /><path d="M16 5h2.5a2 2 0 0 1 0 4H15.5" /><path d="M10 16h4l.5 4h-5z" /><line x1="12" y1="12" x2="12" y2="16" /></>
      case 'palette': return <><path d="M12 3a9 9 0 0 0 0 18 1.6 1.6 0 0 0 1.3-2.6 1.6 1.6 0 0 1 1.3-2.6H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z" /><circle cx="7.5" cy="11.5" r="1" /><circle cx="11" cy="7.8" r="1" /><circle cx="15" cy="8.2" r="1" /></>
      case 'bus': return <><rect x="4" y="4.5" width="16" height="12" rx="2" /><line x1="4" y1="11" x2="20" y2="11" /><circle cx="8" cy="18.5" r="1.4" /><circle cx="16" cy="18.5" r="1.4" /><line x1="8" y1="7.5" x2="11" y2="7.5" /><line x1="13" y1="7.5" x2="16" y2="7.5" /></>
      case 'sprout': return <><path d="M12 20v-8" /><path d="M12 12c0-3.2 2.2-5.2 5.2-5.2 0 3.2-2.2 5.2-5.2 5.2z" /><path d="M12 14.5C12 11.8 10 10 7 10c0 2.7 2 4.5 5 4.5z" /></>
      case 'building': return <><path d="M3 21h18" /><path d="M6 21V4a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v17" /><path d="M15 21V9h3a1 1 0 0 1 1 1v11" /><line x1="9" y1="7" x2="11.5" y2="7" /><line x1="9" y1="11" x2="11.5" y2="11" /><line x1="9" y1="15" x2="11.5" y2="15" /></>
      case 'cap': return <><path d="M12 4 2 9l10 5 10-5-10-5z" /><path d="M6 11v4.5c0 1.1 2.7 2.5 6 2.5s6-1.4 6-2.5V11" /></>
      case 'mapPin': return <><path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></>
      case 'phone': return <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 5.2 2 2 0 0 1 4 3h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L8 12a16 16 0 0 0 6 6l1.6-1.1a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6A2 2 0 0 1 22 16.9z" />
      case 'mail': return <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>
      case 'clock': return <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>
      case 'users': return <><circle cx="9" cy="8" r="3" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="M16 5.5a3 3 0 0 1 0 5.5" /><path d="M17.5 14.5a5.5 5.5 0 0 1 3 5" /></>
      case 'megaphone': return <><path d="m3 11 14-6v14L3 13z" /><path d="M3 11v2.5a1 1 0 0 0 1 1h1" /><path d="M8 15v2a2 2 0 0 0 4 0v-1" /></>
      case 'arrowRight': return <><line x1="4" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" /></>
      case 'externalLink': return <><path d="M15 4h5v5" /><path d="M20 4 11 13" /><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></>
      case 'image': return <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></>
    }
  })()
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">
      {p}
    </svg>
  )
}

// Tinted rounded chip holding a vector icon
function IconChip({ name, size = 52 }: { name: IcoName; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.28, flexShrink: 0,
      background: `${C.rose}33`, display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: C.maroon,
    }}>
      <Ico name={name} size={size * 0.5} width={1.7} />
    </div>
  )
}

// ── Image placeholder ─────────────────────────────────────────────────────────
function ImgPlaceholder({ label, ratio = 56, radius = 0, style = {} }: { label: string; ratio?: number; radius?: number; style?: preact.JSX.CSSProperties }) {
  return (
    <div style={{ position: 'relative', paddingBottom: `${ratio}%`, background: C.creamDk, borderRadius: radius, overflow: 'hidden', ...style }}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: C.roseDk, gap: 8 }}>
        <Ico name="image" size={30} width={1.4} />
        <span style={{ fontSize: '.7rem', textAlign: 'center', maxWidth: 130, lineHeight: 1.35, fontWeight: 500 }}>{label}</span>
      </div>
    </div>
  )
}

// Per-school image: loads <base>/<slug>/<file>; falls back to a labelled
// placeholder if the file is missing or the slug is unknown.
function SchoolImage({ slug, file, label, ratio = 56, radius = 0, style = {} }: { slug: string; file: string; label: string; ratio?: number; radius?: number; style?: preact.JSX.CSSProperties }) {
  const [failed, setFailed] = useState(false)
  if (!slug || failed) return <ImgPlaceholder label={label} ratio={ratio} radius={radius} style={style} />
  return (
    <div style={{ position: 'relative', paddingBottom: `${ratio}%`, background: C.creamDk, borderRadius: radius, overflow: 'hidden', ...style }}>
      <img src={schoolAsset(slug, file)} alt={label} onError={() => setFailed(true)}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
    </div>
  )
}

// Per-school logo on a white chip; tries logo.svg then logo.png, else a monogram.
function SchoolLogo({ slug, name, size = 46, radius = 12 }: { slug: string; name: string; size?: number; radius?: number }) {
  const candidates = ['logo.svg?v=2', 'logo.png?v=2']
  const [idx, setIdx] = useState(0)
  if (!slug || idx >= candidates.length) {
    return (
      <div style={{ width: size, height: size, borderRadius: radius, background: `linear-gradient(135deg, ${C.gold}, ${C.maroon})`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.white, fontWeight: 900, fontSize: size * 0.42, flexShrink: 0 }}>
        {(name || 'S').charAt(0).toUpperCase()}
      </div>
    )
  }
  return (
    <div style={{ width: size, height: size, borderRadius: radius, background: C.white, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 2px 8px rgba(0,0,0,.18)' }}>
      <img src={schoolAsset(slug, candidates[idx])} alt={name} onError={() => setIdx(i => i + 1)}
        style={{ width: size * 0.72, height: size * 0.72, objectFit: 'contain' }} />
    </div>
  )
}

// ── Section helpers ───────────────────────────────────────────────────────────
function Section({ id, bg = C.white, children }: { id?: string; bg?: string; children: preact.ComponentChildren }) {
  return (
    <section id={id} style={{ background: bg }}>
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '4.5rem 1.25rem' }}>{children}</div>
    </section>
  )
}

function SectionHead({ label, title, sub, dark = false }: { label: string; title: string; sub?: string; dark?: boolean }) {
  return (
    <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
      <div style={{ display: 'inline-block', fontSize: '.7rem', fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: C.gold, marginBottom: '.6rem' }}>{label}</div>
      <h2 style={{ fontSize: 'clamp(1.5rem,3vw,2.25rem)', fontWeight: 800, color: dark ? C.white : C.navy, margin: '0 0 .85rem', lineHeight: 1.2 }}>{title}</h2>
      <div style={{ width: 54, height: 3, borderRadius: 2, background: C.gold, margin: '0 auto' }} />
      {sub && <p style={{ color: dark ? 'rgba(255,255,255,.7)' : C.gray600, maxWidth: 580, margin: '1.1rem auto 0', lineHeight: 1.7, fontSize: '.95rem' }}>{sub}</p>}
    </div>
  )
}

// ── Navbar ────────────────────────────────────────────────────────────────────
const NAV_LINKS = ['Home', 'About', 'Academics', 'Facilities', 'Gallery', 'Notices', 'Admissions', 'Contact']

function Navbar({ slug, name, onStaffLogin, onParentLogin }: { slug: string; name: string; onStaffLogin: () => void; onParentLogin: () => void }) {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 40)
    window.addEventListener('scroll', handler, { passive: true })
    return () => window.removeEventListener('scroll', handler)
  }, [])

  function scrollTo(id: string) {
    setMenuOpen(false)
    document.getElementById(id.toLowerCase())?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <nav style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000, fontFamily: FONT, transition: 'background .3s, box-shadow .3s', background: scrolled ? C.navyDk : 'transparent', boxShadow: scrolled ? '0 2px 24px rgba(0,0,0,.35)' : 'none' }}>
      {/* Utility bar */}
      <div style={{ background: C.navyDk, borderBottom: '1px solid rgba(201,162,39,.18)', padding: '.32rem 1.25rem' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.3rem' }}>
          <div style={{ display: 'flex', gap: '1.4rem', fontSize: '.72rem', color: 'rgba(255,255,255,.68)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}><Ico name="phone" size={12} stroke={C.gold} /> +91 XXXXX XXXXX</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}><Ico name="mail" size={12} stroke={C.gold} /> info@daffodilsranchi.edu.in</span>
          </div>
          <div style={{ display: 'flex', gap: '.6rem' }}>
            <button onClick={onParentLogin} style={{ background: 'none', border: `1px solid ${C.gold}`, color: C.gold, borderRadius: 5, padding: '.22rem .7rem', cursor: 'pointer', fontSize: '.7rem', fontFamily: FONT, fontWeight: 600 }}>Parent Login</button>
            <button onClick={onStaffLogin} style={{ background: C.gold, border: 'none', color: C.navy, borderRadius: 5, padding: '.22rem .7rem', cursor: 'pointer', fontSize: '.7rem', fontFamily: FONT, fontWeight: 700 }}>Staff Login</button>
          </div>
        </div>
      </div>

      {/* Main bar */}
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '.7rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', cursor: 'pointer' }} onClick={() => scrollTo('home')}>
          <SchoolLogo slug={slug} name={name} size={46} radius={12} />
          <div>
            <div style={{ color: C.white, fontWeight: 800, fontSize: '1rem', lineHeight: 1.1, letterSpacing: '-.01em' }}>Daffodils Public School</div>
            <div style={{ color: C.gold, fontSize: '.64rem', fontWeight: 600, letterSpacing: '.06em' }}>MESRA, RANCHI · CBSE PATTERN</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '1.75rem', alignItems: 'center' }} class="dps-desk-nav">
          {NAV_LINKS.map(l => (
            <button key={l} onClick={() => scrollTo(l.toLowerCase())} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.85)', cursor: 'pointer', fontFamily: FONT, fontSize: '.82rem', fontWeight: 600, padding: 0, transition: 'color .2s' }}
              onMouseOver={e => (e.currentTarget.style.color = C.gold)} onMouseOut={e => (e.currentTarget.style.color = 'rgba(255,255,255,.85)')}>{l}</button>
          ))}
        </div>

        <button onClick={() => setMenuOpen(o => !o)} style={{ display: 'none', background: 'none', border: 'none', cursor: 'pointer', color: C.white, padding: '.25rem' }} class="dps-hamburger">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            {menuOpen ? <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></> : <><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></>}
          </svg>
        </button>
      </div>

      {menuOpen && (
        <div style={{ background: C.navyDk, borderTop: '1px solid rgba(255,255,255,.08)', padding: '1rem 1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
          {NAV_LINKS.map(l => (
            <button key={l} onClick={() => scrollTo(l.toLowerCase())} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.85)', cursor: 'pointer', fontFamily: FONT, fontSize: '.9rem', fontWeight: 600, textAlign: 'left', padding: '.35rem 0' }}>{l}</button>
          ))}
        </div>
      )}

      <style>{`@media (max-width: 820px){.dps-desk-nav{display:none!important}.dps-hamburger{display:block!important}}`}</style>
    </nav>
  )
}

// ── Hero ──────────────────────────────────────────────────────────────────────
function Hero({ slug, schoolName, announcements }: { slug: string; schoolName: string; announcements: CmsAnnouncement[] }) {
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div id="home" style={{ position: 'relative', minHeight: '100vh', display: 'flex', flexDirection: 'column', background: C.navyDk, fontFamily: FONT, overflow: 'hidden' }}>
      {/* Background: school hero.jpg if present, otherwise the gradient placeholder */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 0, background: 'linear-gradient(155deg, #101A2E 0%, #1C2B4A 45%, #3A2521 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10, color: 'rgba(255,255,255,.07)' }}>
        <Ico name="image" size={56} width={1} />
        <span style={{ fontSize: '.8rem', letterSpacing: '.12em' }}>SCHOOL BUILDING PHOTO</span>
      </div>
      {slug && (
        <img src={schoolAsset(slug, 'hero.jpg')} alt="" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          style={{ position: 'absolute', inset: 0, zIndex: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      )}
      <div style={{ position: 'absolute', inset: 0, zIndex: 1, background: 'linear-gradient(to right, rgba(16,26,46,.94) 48%, rgba(16,26,46,.55) 100%)' }} />

      <div style={{ position: 'relative', zIndex: 2, flex: 1, display: 'flex', alignItems: 'center', maxWidth: 1120, margin: '0 auto', padding: '8rem 1.25rem 4rem', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ maxWidth: 640 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '.5rem', background: 'rgba(201,162,39,.14)', border: '1px solid rgba(201,162,39,.3)', borderRadius: 9999, padding: '.35rem 1rem', marginBottom: '1.5rem', color: C.gold, fontSize: '.74rem', fontWeight: 700, letterSpacing: '.08em' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.gold, display: 'inline-block' }} />
            CBSE PATTERN · ENGLISH MEDIUM
          </div>

          <h1 style={{ color: C.white, fontSize: 'clamp(2.1rem,5vw,3.6rem)', fontWeight: 900, lineHeight: 1.08, margin: '0 0 .5rem', letterSpacing: '-.02em' }}>
            {schoolName || 'Daffodils Public School'}
          </h1>
          <div style={{ color: C.gold, fontSize: 'clamp(1rem,2vw,1.3rem)', fontWeight: 600, marginBottom: '1.25rem' }}>Mesra, Ranchi — Jharkhand</div>
          <p style={{ color: 'rgba(255,255,255,.76)', fontSize: '1.05rem', lineHeight: 1.7, margin: '0 0 2.25rem', maxWidth: 510 }}>
            Nurturing young minds from Nursery to Class VIII with quality education, a caring environment, and values-driven learning in the heart of Mesra, Ranchi.
          </p>

          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <button onClick={() => scrollTo('admissions')} style={{ display: 'inline-flex', alignItems: 'center', gap: '.5rem', background: C.gold, color: C.navy, border: 'none', borderRadius: 7, padding: '.85rem 1.9rem', fontFamily: FONT, fontWeight: 800, fontSize: '1rem', cursor: 'pointer', transition: 'transform .15s, background .15s' }}
              onMouseOver={e => { e.currentTarget.style.background = C.goldLt; e.currentTarget.style.transform = 'translateY(-1px)' }}
              onMouseOut={e => { e.currentTarget.style.background = C.gold; e.currentTarget.style.transform = '' }}>
              Apply for Admissions <Ico name="arrowRight" size={17} stroke={C.navy} width={2} />
            </button>
            <button onClick={() => scrollTo('about')} style={{ background: 'transparent', color: C.white, border: '2px solid rgba(255,255,255,.32)', borderRadius: 7, padding: '.85rem 1.9rem', fontFamily: FONT, fontWeight: 700, fontSize: '1rem', cursor: 'pointer', transition: 'border-color .15s, color .15s' }}
              onMouseOver={e => { e.currentTarget.style.borderColor = C.gold; e.currentTarget.style.color = C.gold }}
              onMouseOut={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,.32)'; e.currentTarget.style.color = C.white }}>
              Learn More
            </button>
          </div>
        </div>
      </div>

      <div style={{ position: 'relative', zIndex: 2, borderTop: '1px solid rgba(255,255,255,.08)', background: 'rgba(0,0,0,.35)', backdropFilter: 'blur(8px)' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto', padding: '1.25rem', display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '1rem' }}>
          {[
            { num: '1000+', label: 'Students Enrolled' },
            { num: '60+', label: 'Qualified Faculty' },
            { num: 'Nur–VIII', label: 'Classes Offered' },
            { num: 'CBSE', label: 'Pattern Followed' },
          ].map(s => (
            <div key={s.label} style={{ textAlign: 'center' }}>
              <div style={{ color: C.gold, fontSize: 'clamp(1.1rem,3vw,1.8rem)', fontWeight: 900, lineHeight: 1 }}>{s.num}</div>
              <div style={{ color: 'rgba(255,255,255,.6)', fontSize: '.72rem', fontWeight: 600, marginTop: '.3rem', letterSpacing: '.03em' }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {announcements.length > 0 && (
        <div style={{ position: 'relative', zIndex: 2, background: C.gold, padding: '.5rem 1.25rem', display: 'flex', gap: '.75rem', alignItems: 'center', overflow: 'hidden' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', color: C.navy, fontWeight: 800, fontSize: '.74rem', whiteSpace: 'nowrap', flexShrink: 0, letterSpacing: '.04em' }}>
            <Ico name="megaphone" size={15} stroke={C.navy} /> NOTICE
          </span>
          <div style={{ overflow: 'hidden', flex: 1 }}>
            <div style={{ whiteSpace: 'nowrap', animation: 'dps-ticker 30s linear infinite', display: 'inline-block', color: C.navy, fontSize: '.8rem', fontWeight: 600 }}>
              {announcements.map(a => a.title).join('     •     ')}
            </div>
          </div>
          <style>{`@keyframes dps-ticker{from{transform:translateX(100%)}to{transform:translateX(-100%)}}`}</style>
        </div>
      )}
    </div>
  )
}

// ── About ─────────────────────────────────────────────────────────────────────
function About({ slug }: { slug: string }) {
  const cards: { icon: IcoName; title: string; body: string }[] = [
    { icon: 'target', title: 'Our Mission', body: 'To provide holistic, value-based English medium education in the CBSE pattern, helping every child build a strong foundation for lifelong learning.' },
    { icon: 'star', title: 'Our Vision', body: 'To be Ranchi\'s most trusted primary school — where every child is seen, supported, and inspired to realise their fullest potential.' },
    { icon: 'heart', title: 'Our Values', body: 'Integrity, discipline, curiosity, and compassion form the bedrock of our culture. We celebrate every child and nurture confidence from the earliest grades.' },
  ]
  return (
    <Section id="about" bg={C.cream}>
      <SectionHead label="About Us" title="A School Built on Purpose" sub="Founded in Mesra, Ranchi, Daffodils Public School shapes young minds from Nursery to Class VIII through quality education, modern facilities, and a nurturing environment." />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(290px,1fr))', gap: '2rem', alignItems: 'stretch' }}>
        <SchoolImage slug={slug} file="building.jpg" label="School Building — Front View" ratio={72} radius={14} style={{ height: '100%' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {cards.map(c => (
            <div key={c.title} style={{ background: C.white, borderRadius: 12, padding: '1.25rem', border: `1px solid ${C.creamDk}`, boxShadow: '0 2px 10px rgba(155,74,63,.05)', display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
              <IconChip name={c.icon} size={46} />
              <div>
                <div style={{ fontWeight: 700, color: C.navy, marginBottom: '.3rem', fontSize: '.95rem' }}>{c.title}</div>
                <p style={{ color: C.gray600, fontSize: '.85rem', lineHeight: 1.65, margin: 0 }}>{c.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Section>
  )
}

// ── Stats band ────────────────────────────────────────────────────────────────
function Stats() {
  const items = [
    { num: '10+', label: 'Years of Service' },
    { num: '1000+', label: 'Students Enrolled' },
    { num: '60+', label: 'Qualified Teachers' },
    { num: '20+', label: 'Activities & Clubs' },
  ]
  return (
    <div style={{ background: `linear-gradient(135deg, ${C.navy}, ${C.navyDk})`, fontFamily: FONT }}>
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '3rem 1.25rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: '1.5rem' }}>
        {items.map((s, i) => (
          <div key={s.label} style={{ textAlign: 'center', padding: '1.25rem', borderRight: i < items.length - 1 ? '1px solid rgba(255,255,255,.1)' : 'none' }}>
            <div style={{ fontSize: 'clamp(2rem,4vw,2.8rem)', fontWeight: 900, color: C.gold, lineHeight: 1 }}>{s.num}</div>
            <div style={{ color: 'rgba(255,255,255,.65)', fontSize: '.78rem', fontWeight: 600, marginTop: '.45rem', letterSpacing: '.04em', textTransform: 'uppercase' }}>{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Facilities ────────────────────────────────────────────────────────────────
function Facilities() {
  const items: { icon: IcoName; title: string; body: string }[] = [
    { icon: 'monitor', title: 'Smart Classrooms', body: 'Interactive digital boards and ICT-enabled learning in bright, spacious classrooms.' },
    { icon: 'book', title: 'Rich Library', body: 'A growing collection of story books and reference material to spark a love of reading.' },
    { icon: 'trophy', title: 'Sports & Athletics', body: 'Large playgrounds and daily physical activity — cricket, football, and athletics.' },
    { icon: 'palette', title: 'Arts & Culture', body: 'Music, dance, painting, and theatre nurture creativity alongside academics.' },
    { icon: 'bus', title: 'Safe Transport', body: 'Well-maintained school buses covering all major routes across Ranchi.' },
  ]
  return (
    <Section id="facilities" bg={C.white}>
      <SectionHead label="Why Choose Us" title="Everything a Great School Should Be" sub="We combine caring teaching with co-curricular breadth so every child discovers their strengths." />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', justifyContent: 'center' }}>
        {items.map(i => (
          <div key={i.title} style={{ flex: '1 1 300px', maxWidth: 340, background: C.cream, borderRadius: 14, padding: '1.6rem', border: `1px solid ${C.creamDk}`, transition: 'transform .2s, box-shadow .2s' }}
            onMouseOver={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = '0 10px 28px rgba(155,74,63,.13)' }}
            onMouseOut={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '' }}>
            <IconChip name={i.icon} size={54} />
            <div style={{ fontWeight: 700, color: C.navy, margin: '1rem 0 .4rem', fontSize: '1.05rem' }}>{i.title}</div>
            <p style={{ color: C.gray600, fontSize: '.86rem', lineHeight: 1.65, margin: 0 }}>{i.body}</p>
          </div>
        ))}
      </div>
    </Section>
  )
}

// ── Principal's message ───────────────────────────────────────────────────────
function PrincipalMessage({ slug }: { slug: string }) {
  return (
    <Section bg={C.creamDk}>
      <SectionHead label="Leadership" title="Principal's Message" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: '3rem', alignItems: 'center' }}>
        <div style={{ maxWidth: 320, margin: '0 auto', width: '100%' }}>
          <SchoolImage slug={slug} file="principal.jpg" label="Principal's Photo" ratio={110} radius={14} />
          <div style={{ textAlign: 'center', marginTop: '1rem' }}>
            <div style={{ fontWeight: 700, color: C.navy, fontSize: '1rem' }}>[Principal's Name]</div>
            <div style={{ color: C.maroon, fontSize: '.8rem', fontWeight: 600 }}>Principal, Daffodils Public School</div>
          </div>
        </div>
        <div>
          <div style={{ fontSize: '3.5rem', color: C.gold, lineHeight: .8, marginBottom: '.5rem', fontFamily: 'Georgia, serif' }}>&ldquo;</div>
          <p style={{ color: C.gray600, fontSize: '1.02rem', lineHeight: 1.8, margin: '0 0 1rem', fontStyle: 'italic' }}>
            At Daffodils, we believe every child is a unique gift. Our role is not merely to transfer knowledge, but to ignite curiosity, build character, and give each child a strong, joyful foundation for the years ahead.
          </p>
          <p style={{ color: C.gray600, fontSize: '1.02rem', lineHeight: 1.8, margin: '0 0 1.5rem', fontStyle: 'italic' }}>
            Our dedicated teachers, warm classrooms, and vibrant activities ensure that every student grows in confidence, compassion, and a lasting love for learning.
          </p>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <div style={{ width: 4, background: C.gold, borderRadius: 2, flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: 700, color: C.navy }}>Warm regards,</div>
              <div style={{ color: C.gray600, fontSize: '.85rem' }}>The Principal</div>
            </div>
          </div>
        </div>
      </div>
    </Section>
  )
}

// ── Academics ─────────────────────────────────────────────────────────────────
function Academics() {
  const streams: { icon: IcoName; grade: string; range: string; bg: string; bd: string }[] = [
    { icon: 'sprout', grade: 'Pre-Primary', range: 'Nursery · LKG · UKG', bg: '#FEF3E2', bd: '#F5D9A8' },
    { icon: 'pencil', grade: 'Primary', range: 'Class I — V', bg: '#FDEBE6', bd: '#F2C6BA' },
    { icon: 'flask', grade: 'Middle School', range: 'Class VI — VIII', bg: '#EAF2EC', bd: '#BFD9C6' },
  ]
  return (
    <Section id="academics" bg={C.white}>
      <SectionHead label="Academics" title="A Strong Early Foundation" sub="From Nursery through Class VIII, we offer a structured, age-appropriate learning pathway aligned with the CBSE pattern." />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '1.25rem', marginBottom: '2.5rem' }}>
        {streams.map(s => (
          <div key={s.grade} style={{ background: s.bg, border: `1px solid ${s.bd}`, borderRadius: 14, padding: '1.75rem 1.25rem', textAlign: 'center' }}>
            <div style={{ display: 'inline-flex', width: 56, height: 56, borderRadius: 16, background: C.white, alignItems: 'center', justifyContent: 'center', color: C.maroon, marginBottom: '.85rem', boxShadow: '0 2px 8px rgba(0,0,0,.05)' }}>
              <Ico name={s.icon} size={28} width={1.7} />
            </div>
            <div style={{ fontWeight: 700, color: C.navy, fontSize: '1rem', marginBottom: '.3rem' }}>{s.grade}</div>
            <div style={{ color: C.gray600, fontSize: '.82rem' }}>{s.range}</div>
          </div>
        ))}
      </div>
      <div style={{ background: C.navy, borderRadius: 14, padding: '1.5rem 2rem', display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
        <div style={{ color: C.gold }}><Ico name="building" size={34} stroke={C.gold} /></div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ color: C.white, fontWeight: 700, marginBottom: '.25rem' }}>English Medium · CBSE Pattern</div>
          <div style={{ color: 'rgba(255,255,255,.65)', fontSize: '.82rem', lineHeight: 1.6 }}>Daffodils Public School follows the CBSE pattern of education from Nursery through Class VIII, with a strong emphasis on English medium learning and all-round development.</div>
        </div>
      </div>
    </Section>
  )
}

// ── Gallery ───────────────────────────────────────────────────────────────────
function Gallery({ slug }: { slug: string }) {
  const photos: { file: string; label: string }[] = [
    { file: 'gallery1.png', label: 'School Building — Main Block' },
    { file: 'gallery2.png', label: 'School Assembly Ground' },
    { file: 'gallery3.png', label: 'Smart Classroom' },
    { file: 'gallery4.png', label: 'Library Reading Corner' },
    { file: 'gallery5.png', label: 'Annual Day Celebration' },
    { file: 'gallery6.png', label: 'Sports & Games' },
    { file: 'gallery7.png', label: 'Art & Craft Class' },
    { file: 'gallery8.png', label: 'Students at Prayer' },
    { file: 'gallery9.png', label: 'Independence Day' },
  ]
  return (
    <Section id="gallery" bg={C.cream}>
      <SectionHead label="Gallery" title="Life at Daffodils" sub="A glimpse into our vibrant school community — from classrooms to the playground." />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))', gap: '.85rem' }}>
        {photos.map((p, i) => (
          <div key={i} style={{ overflow: 'hidden', borderRadius: 12, cursor: 'pointer', transition: 'transform .2s, box-shadow .2s' }}
            onMouseOver={e => { e.currentTarget.style.transform = 'scale(1.02)'; e.currentTarget.style.boxShadow = '0 8px 22px rgba(155,74,63,.16)' }}
            onMouseOut={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '' }}>
            <SchoolImage slug={slug} file={p.file} label={p.label} ratio={66} radius={12} />
          </div>
        ))}
      </div>
    </Section>
  )
}

// ── Notice Board ──────────────────────────────────────────────────────────────
function NoticeBoard({ announcements }: { announcements: CmsAnnouncement[] }) {
  function fmtDate(iso: string | null) {
    if (!iso) return ''
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  }
  return (
    <Section id="notices" bg={C.white}>
      <SectionHead label="Notice Board" title="Announcements & Notices" sub="Stay informed with the latest updates from the school administration." />
      {announcements.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem 0', color: C.gray400 }}>
          <Ico name="megaphone" size={44} stroke={C.gray400} width={1.2} />
          <p style={{ marginTop: '1rem', fontSize: '.9rem' }}>No notices at this time.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {announcements.map(a => (
            <div key={a.id} style={{ display: 'flex', gap: '1.25rem', alignItems: 'flex-start', background: C.cream, borderRadius: 14, padding: '1.25rem 1.5rem', border: `1px solid ${C.creamDk}`, borderLeft: `4px solid ${C.gold}` }}>
              <div style={{ flexShrink: 0, paddingTop: '.1rem' }}>
                <IconChip name="megaphone" size={42} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem', flexWrap: 'wrap' }}>
                  <div style={{ fontWeight: 700, color: C.navy, fontSize: '1rem' }}>{a.title}</div>
                  {a.published_at && (
                    <div style={{ fontSize: '.72rem', color: C.gray500, whiteSpace: 'nowrap', fontWeight: 600 }}>{fmtDate(a.published_at)}</div>
                  )}
                </div>
                {a.body && <p style={{ color: C.gray600, fontSize: '.87rem', lineHeight: 1.7, margin: '.4rem 0 0' }}>{a.body}</p>}
                {a.expires_at && (
                  <div style={{ marginTop: '.5rem', fontSize: '.72rem', color: C.roseDk, fontWeight: 600 }}>Valid until {fmtDate(a.expires_at)}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

// ── Admissions ────────────────────────────────────────────────────────────────
function Admissions() {
  const steps = [
    { n: '01', title: 'Collect the Form', body: 'Pick up the admission form from the school office or download it from our website.' },
    { n: '02', title: 'Submit Documents', body: 'Submit the filled form with the birth certificate, previous report card, and a passport photo.' },
    { n: '03', title: 'Interaction', body: 'A brief, friendly interaction with the child and parents, as applicable for the class applied.' },
    { n: '04', title: 'Confirmation', body: 'Receive the admission confirmation and complete the fee payment to secure the seat.' },
  ]
  return (
    <section id="admissions" style={{ background: `linear-gradient(135deg, ${C.navy} 0%, ${C.maroon} 100%)` }}>
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '4.5rem 1.25rem' }}>
        <SectionHead label="Admissions Open" title="Join the Daffodils Family" sub="We welcome applications for Nursery to Class VIII, subject to seat availability. Admissions for the new academic session are now open." dark />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '1.5rem', marginBottom: '3rem' }}>
          {steps.map(s => (
            <div key={s.n} style={{ background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.13)', borderRadius: 14, padding: '1.6rem' }}>
              <div style={{ color: C.gold, fontWeight: 900, fontSize: '1.6rem', marginBottom: '.5rem' }}>{s.n}</div>
              <div style={{ color: C.white, fontWeight: 700, marginBottom: '.4rem', fontSize: '.98rem' }}>{s.title}</div>
              <p style={{ color: 'rgba(255,255,255,.62)', fontSize: '.83rem', lineHeight: 1.65, margin: 0 }}>{s.body}</p>
            </div>
          ))}
        </div>
        <AdmissionForm theme={{ accent: C.gold, accentText: C.navy, font: FONT }} />
        <p style={{ color: 'rgba(255,255,255,.5)', fontSize: '.78rem', marginTop: '1rem', textAlign: 'center' }}>Prefer to call? Visit the school office · Monday to Saturday, 9 AM to 4 PM</p>
      </div>
    </section>
  )
}

// ── Contact ───────────────────────────────────────────────────────────────────
function Contact() {
  const info: { icon: IcoName; label: string; lines: string[] }[] = [
    { icon: 'mapPin', label: 'Address', lines: ['Daffodils Public School', 'Mesra, Ranchi — 835215', 'Jharkhand, India'] },
    { icon: 'phone', label: 'Phone', lines: ['+91 XXXXX XXXXX', '+91 XXXXX XXXXX'] },
    { icon: 'mail', label: 'Email', lines: ['info@daffodilsranchi.edu.in', 'admissions@daffodilsranchi.edu.in'] },
    { icon: 'clock', label: 'Office Hours', lines: ['Monday – Saturday', '9:00 AM to 4:00 PM'] },
  ]
  return (
    <Section id="contact" bg={C.white}>
      <SectionHead label="Get in Touch" title="We'd Love to Hear From You" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: '3rem', alignItems: 'start' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          {info.map(i => (
            <div key={i.label} style={{ background: C.cream, borderRadius: 12, padding: '1.2rem', border: `1px solid ${C.creamDk}` }}>
              <IconChip name={i.icon} size={42} />
              <div style={{ fontWeight: 700, color: C.navy, fontSize: '.82rem', margin: '.6rem 0 .4rem' }}>{i.label}</div>
              {i.lines.map(l => <div key={l} style={{ color: C.gray600, fontSize: '.8rem', lineHeight: 1.6 }}>{l}</div>)}
            </div>
          ))}
        </div>
        <div>
          <ImgPlaceholder label="Google Maps — Daffodils Public School, Mesra Ranchi" ratio={72} radius={14} />
          <a href="https://maps.google.com/?q=Mesra+Ranchi+Jharkhand" target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', marginTop: '.85rem', color: C.navy, fontWeight: 600, fontSize: '.82rem', textDecoration: 'none' }}>
            Open in Google Maps <Ico name="externalLink" size={14} stroke={C.navy} />
          </a>
        </div>
      </div>
    </Section>
  )
}

// ── Footer ────────────────────────────────────────────────────────────────────
function Footer({ slug, name, onStaffLogin, onParentLogin }: { slug: string; name: string; onStaffLogin: () => void; onParentLogin: () => void }) {
  const year = new Date().getFullYear()
  return (
    <footer style={{ background: C.navyDk, color: 'rgba(255,255,255,.7)', fontFamily: FONT }}>
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '3.25rem 1.25rem 1.5rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '2.5rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', marginBottom: '1rem' }}>
            <SchoolLogo slug={slug} name={name} size={40} radius={10} />
            <div>
              <div style={{ color: C.white, fontWeight: 800, fontSize: '.88rem' }}>Daffodils Public School</div>
              <div style={{ color: C.gold, fontSize: '.62rem', fontWeight: 600, letterSpacing: '.05em' }}>MESRA, RANCHI</div>
            </div>
          </div>
          <p style={{ fontSize: '.8rem', lineHeight: 1.7, margin: 0, maxWidth: 240 }}>An English medium school following the CBSE pattern, committed to holistic education and lifelong values from Nursery to Class VIII.</p>
        </div>

        <div>
          <div style={{ color: C.gold, fontWeight: 700, fontSize: '.78rem', letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: '1rem' }}>Quick Links</div>
          {NAV_LINKS.slice(1).map(l => (
            <div key={l} style={{ marginBottom: '.45rem' }}>
              <a href={`#${l.toLowerCase()}`} style={{ color: 'rgba(255,255,255,.65)', fontSize: '.82rem', textDecoration: 'none' }}
                onMouseOver={e => { (e.currentTarget as HTMLElement).style.color = C.gold }} onMouseOut={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,.65)' }}>{l}</a>
            </div>
          ))}
        </div>

        <div>
          <div style={{ color: C.gold, fontWeight: 700, fontSize: '.78rem', letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: '1rem' }}>Contact</div>
          <p style={{ fontSize: '.82rem', lineHeight: 1.85, margin: 0 }}>
            Mesra, Ranchi — 835215<br />Jharkhand, India<br />+91 XXXXX XXXXX<br />info@daffodilsranchi.edu.in
          </p>
        </div>

        <div>
          <div style={{ color: C.gold, fontWeight: 700, fontSize: '.78rem', letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: '1rem' }}>Portal Access</div>
          <button onClick={onParentLogin} style={{ display: 'flex', alignItems: 'center', gap: '.55rem', background: 'rgba(201,162,39,.14)', border: '1px solid rgba(201,162,39,.3)', color: C.gold, borderRadius: 7, padding: '.55rem 1rem', fontFamily: FONT, fontWeight: 600, fontSize: '.82rem', cursor: 'pointer', width: '100%', marginBottom: '.55rem' }}>
            <Ico name="users" size={16} stroke={C.gold} /> Parent Portal
          </button>
          <button onClick={onStaffLogin} style={{ display: 'flex', alignItems: 'center', gap: '.55rem', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', color: 'rgba(255,255,255,.78)', borderRadius: 7, padding: '.55rem 1rem', fontFamily: FONT, fontWeight: 600, fontSize: '.82rem', cursor: 'pointer', width: '100%' }}>
            <Ico name="building" size={16} stroke="rgba(255,255,255,.78)" /> Staff Portal
          </button>
        </div>
      </div>

      <div style={{ borderTop: '1px solid rgba(255,255,255,.08)', maxWidth: 1120, margin: '0 auto', padding: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem' }}>
        <span style={{ fontSize: '.72rem' }}>© {year} Daffodils Public School, Mesra Ranchi. All rights reserved.</span>
        <span style={{ fontSize: '.72rem', color: 'rgba(255,255,255,.35)' }}>Powered by Tulips.edu</span>
      </div>
    </footer>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────
export function DaffodilsPublicSchool({ onStaffLogin, onParentLogin }: { onStaffLogin: () => void; onParentLogin: () => void }) {
  const [slug] = useState(() => schoolSlug())
  const [schoolName, setSchoolName] = useState('')
  const [announcements, setAnnouncements] = useState<CmsAnnouncement[]>([])

  useEffect(() => {
    cmsPublic.schoolInfo().then(s => setSchoolName(s.name)).catch(() => {})
    cmsPublic.announcements().then(a => setAnnouncements(a.filter(x => x.is_published))).catch(() => {})
  }, [])

  return (
    <div style={{ fontFamily: FONT }}>
      <Navbar slug={slug} name={schoolName} onStaffLogin={onStaffLogin} onParentLogin={onParentLogin} />
      <Hero slug={slug} schoolName={schoolName} announcements={announcements} />
      <About slug={slug} />
      <Stats />
      <Facilities />
      <PrincipalMessage slug={slug} />
      <Academics />
      <Gallery slug={slug} />
      <NoticeBoard announcements={announcements} />
      <Admissions />
      <Contact />
      <Footer slug={slug} name={schoolName} onStaffLogin={onStaffLogin} onParentLogin={onParentLogin} />
    </div>
  )
}
