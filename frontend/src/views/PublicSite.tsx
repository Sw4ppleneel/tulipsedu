import { useEffect, useRef, useState } from 'preact/hooks'
import { cmsPublic } from '../api/cms'
import type { CmsAnnouncement } from '../api/cms'

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  navy:    '#1C2B4A',
  navyDk:  '#111B30',
  gold:    '#C9A227',
  goldLt:  '#F0D060',
  maroon:  '#9B4A3F',
  rose:    '#E3B2A4',
  cream:   '#FBF0EC',
  creamDk: '#F0D9D1',
  white:   '#FFFFFF',
  gray50:  '#F9FAFB',
  gray100: '#F3F4F6',
  gray400: '#9CA3AF',
  gray600: '#4B5563',
  gray900: '#111827',
}

const FONT = "'Segoe UI', system-ui, -apple-system, sans-serif"

// ── Image placeholder helper ──────────────────────────────────────────────────
function ImgPlaceholder({
  label, ratio = 56, radius = 0, style = {},
}: {
  label: string; ratio?: number; radius?: number; style?: preact.JSX.CSSProperties
}) {
  return (
    <div style={{
      position: 'relative', paddingBottom: `${ratio}%`, background: C.creamDk,
      borderRadius: radius, overflow: 'hidden', ...style,
    }}>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', color: C.gray400, gap: 6,
      }}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        <span style={{ fontSize: '.7rem', textAlign: 'center', maxWidth: 100, lineHeight: 1.3 }}>{label}</span>
      </div>
    </div>
  )
}

// ── Section wrapper ───────────────────────────────────────────────────────────
function Section({
  id, bg = C.white, children, style = {},
}: {
  id?: string; bg?: string; children: preact.ComponentChildren; style?: preact.JSX.CSSProperties
}) {
  return (
    <section id={id} style={{ background: bg, ...style }}>
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '4rem 1.25rem' }}>
        {children}
      </div>
    </section>
  )
}

function SectionHead({ label, title, sub }: { label: string; title: string; sub?: string }) {
  return (
    <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
      <div style={{
        display: 'inline-block', fontSize: '.7rem', fontWeight: 700, letterSpacing: '0.12em',
        textTransform: 'uppercase', color: C.gold, background: `${C.navy}0D`,
        borderRadius: 9999, padding: '.3rem .9rem', marginBottom: '.75rem',
      }}>{label}</div>
      <h2 style={{ fontSize: 'clamp(1.5rem,3vw,2.25rem)', fontWeight: 800, color: C.navy, margin: '0 0 .5rem', lineHeight: 1.2 }}>
        {title}
      </h2>
      {sub && <p style={{ color: C.gray600, maxWidth: 560, margin: '0 auto', lineHeight: 1.7, fontSize: '.95rem' }}>{sub}</p>}
    </div>
  )
}

// ── Nav ───────────────────────────────────────────────────────────────────────
const NAV_LINKS = ['Home', 'About', 'Academics', 'Facilities', 'Gallery', 'Admissions', 'Contact']

function Navbar({
  schoolName, onStaffLogin, onParentLogin,
}: {
  schoolName: string; onStaffLogin: () => void; onParentLogin: () => void
}) {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 40)
    window.addEventListener('scroll', handler, { passive: true })
    return () => window.removeEventListener('scroll', handler)
  }, [])

  function scrollTo(id: string) {
    setMenuOpen(false)
    const el = document.getElementById(id.toLowerCase())
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <nav style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000,
      background: scrolled ? C.navyDk : 'transparent',
      backdropFilter: scrolled ? 'blur(10px)' : 'none',
      transition: 'background .3s, box-shadow .3s',
      boxShadow: scrolled ? '0 2px 20px rgba(0,0,0,.3)' : 'none',
      fontFamily: FONT,
    }}>
      {/* Top bar */}
      <div style={{ background: C.navyDk, borderBottom: `1px solid rgba(201,162,39,.2)`, padding: '.3rem 1.25rem' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.25rem' }}>
          <div style={{ display: 'flex', gap: '1.5rem', fontSize: '.72rem', color: 'rgba(255,255,255,.7)' }}>
            <span>📞 +91 XXXXX XXXXX</span>
            <span>✉ info@daffodilsranchi.edu.in</span>
          </div>
          <div style={{ display: 'flex', gap: '.75rem' }}>
            <button onClick={onParentLogin} style={{ background: 'none', border: `1px solid ${C.gold}`, color: C.gold, borderRadius: 4, padding: '.2rem .6rem', cursor: 'pointer', fontSize: '.7rem', fontFamily: FONT, fontWeight: 600 }}>
              Parent Login
            </button>
            <button onClick={onStaffLogin} style={{ background: C.gold, border: 'none', color: C.navy, borderRadius: 4, padding: '.2rem .6rem', cursor: 'pointer', fontSize: '.7rem', fontFamily: FONT, fontWeight: 700 }}>
              Staff Login
            </button>
          </div>
        </div>
      </div>

      {/* Main nav */}
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '.75rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', cursor: 'pointer' }} onClick={() => scrollTo('home')}>
          <div style={{
            width: 44, height: 44, borderRadius: 10, background: `linear-gradient(135deg, ${C.gold}, ${C.maroon})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: C.white, fontWeight: 900, fontSize: '1.3rem', flexShrink: 0,
          }}>D</div>
          <div>
            <div style={{ color: C.white, fontWeight: 800, fontSize: '1rem', lineHeight: 1.1, letterSpacing: '-.01em' }}>
              Daffodils Public School
            </div>
            <div style={{ color: C.gold, fontSize: '.65rem', fontWeight: 600, letterSpacing: '.05em' }}>
              MESRA, RANCHI · CBSE
            </div>
          </div>
        </div>

        {/* Desktop nav links */}
        <div style={{ display: 'flex', gap: '1.75rem', alignItems: 'center' }} class="dps-desk-nav">
          {NAV_LINKS.map(l => (
            <button key={l} onClick={() => scrollTo(l.toLowerCase())}
              style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.85)', cursor: 'pointer', fontFamily: FONT, fontSize: '.82rem', fontWeight: 600, padding: 0, transition: 'color .2s' }}
              onMouseOver={e => (e.currentTarget.style.color = C.gold)}
              onMouseOut={e => (e.currentTarget.style.color = 'rgba(255,255,255,.85)')}>
              {l}
            </button>
          ))}
        </div>

        {/* Hamburger */}
        <button onClick={() => setMenuOpen(o => !o)}
          style={{ display: 'none', background: 'none', border: 'none', cursor: 'pointer', color: C.white, padding: '.25rem' }}
          class="dps-hamburger">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            {menuOpen
              ? <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>
              : <><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></>
            }
          </svg>
        </button>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div style={{ background: C.navyDk, borderTop: `1px solid rgba(255,255,255,.08)`, padding: '1rem 1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
          {NAV_LINKS.map(l => (
            <button key={l} onClick={() => scrollTo(l.toLowerCase())}
              style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.85)', cursor: 'pointer', fontFamily: FONT, fontSize: '.9rem', fontWeight: 600, textAlign: 'left', padding: '.35rem 0' }}>
              {l}
            </button>
          ))}
        </div>
      )}

      <style>{`
        @media (max-width: 768px) {
          .dps-desk-nav { display: none !important; }
          .dps-hamburger { display: block !important; }
        }
      `}</style>
    </nav>
  )
}

// ── Hero ──────────────────────────────────────────────────────────────────────
function Hero({ schoolName, announcements }: { schoolName: string; announcements: CmsAnnouncement[] }) {
  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div id="home" style={{ position: 'relative', minHeight: '100vh', display: 'flex', flexDirection: 'column', background: C.navyDk, fontFamily: FONT, overflow: 'hidden' }}>
      {/* Background placeholder — replace with school building photo */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
        <div style={{ width: '100%', height: '100%', background: `linear-gradient(160deg, #0E1828 0%, #1C2B4A 50%, #2A1A1A 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8, color: 'rgba(255,255,255,.08)' }}>
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
          <span style={{ fontSize: '.8rem', letterSpacing: '.1em' }}>SCHOOL BUILDING PHOTO</span>
        </div>
      </div>
      {/* Gradient overlay */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 1, background: 'linear-gradient(to right, rgba(14,24,40,.92) 50%, rgba(14,24,40,.5) 100%)' }} />

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 2, flex: 1, display: 'flex', alignItems: 'center', maxWidth: 1120, margin: '0 auto', padding: '8rem 1.25rem 4rem', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ maxWidth: 620 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '.5rem',
            background: `rgba(201,162,39,.15)`, border: `1px solid rgba(201,162,39,.3)`,
            borderRadius: 9999, padding: '.35rem 1rem', marginBottom: '1.5rem',
            color: C.gold, fontSize: '.75rem', fontWeight: 700, letterSpacing: '.08em',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.gold, display: 'inline-block' }} />
            CBSE AFFILIATED · ENGLISH MEDIUM
          </div>

          <h1 style={{ color: C.white, fontSize: 'clamp(2rem,5vw,3.5rem)', fontWeight: 900, lineHeight: 1.1, margin: '0 0 .5rem', letterSpacing: '-.02em' }}>
            {schoolName || 'Daffodils Public School'}
          </h1>
          <div style={{ color: C.gold, fontSize: 'clamp(1rem,2vw,1.3rem)', fontWeight: 600, marginBottom: '1.25rem', letterSpacing: '.02em' }}>
            Mesra, Ranchi — Jharkhand
          </div>
          <p style={{ color: 'rgba(255,255,255,.75)', fontSize: '1.05rem', lineHeight: 1.7, margin: '0 0 2.25rem', maxWidth: 500 }}>
            Nurturing young minds with quality education, modern infrastructure, and values-driven learning in the heart of Mesra, Ranchi since our founding.
          </p>

          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <button onClick={() => scrollTo('admissions')} style={{
              background: C.gold, color: C.navy, border: 'none', borderRadius: 6,
              padding: '.85rem 2rem', fontFamily: FONT, fontWeight: 800, fontSize: '1rem',
              cursor: 'pointer', transition: 'transform .15s, background .15s',
            }}
              onMouseOver={e => { e.currentTarget.style.background = C.goldLt; e.currentTarget.style.transform = 'translateY(-1px)' }}
              onMouseOut={e => { e.currentTarget.style.background = C.gold; e.currentTarget.style.transform = '' }}>
              Apply for Admissions →
            </button>
            <button onClick={() => scrollTo('about')} style={{
              background: 'transparent', color: C.white,
              border: '2px solid rgba(255,255,255,.35)', borderRadius: 6,
              padding: '.85rem 2rem', fontFamily: FONT, fontWeight: 700, fontSize: '1rem',
              cursor: 'pointer', transition: 'border-color .15s',
            }}
              onMouseOver={e => { e.currentTarget.style.borderColor = C.gold; e.currentTarget.style.color = C.gold }}
              onMouseOut={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,.35)'; e.currentTarget.style.color = C.white }}>
              Learn More
            </button>
          </div>
        </div>
      </div>

      {/* Stat strip */}
      <div style={{ position: 'relative', zIndex: 2, borderTop: `1px solid rgba(255,255,255,.08)`, background: 'rgba(0,0,0,.35)', backdropFilter: 'blur(8px)' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto', padding: '1.25rem', display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '1rem' }}>
          {[
            { num: '1000+', label: 'Students Enrolled' },
            { num: '60+', label: 'Qualified Faculty' },
            { num: 'I–XII', label: 'Classes Offered' },
            { num: 'CBSE', label: 'Affiliated Board' },
          ].map(s => (
            <div key={s.label} style={{ textAlign: 'center' }}>
              <div style={{ color: C.gold, fontSize: 'clamp(1.2rem,3vw,1.8rem)', fontWeight: 900, lineHeight: 1 }}>{s.num}</div>
              <div style={{ color: 'rgba(255,255,255,.6)', fontSize: '.72rem', fontWeight: 600, marginTop: '.25rem', letterSpacing: '.03em' }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Announcement ticker */}
      {announcements.length > 0 && (
        <div style={{ position: 'relative', zIndex: 2, background: C.gold, padding: '.5rem 1.25rem', display: 'flex', gap: '1rem', alignItems: 'center', overflow: 'hidden' }}>
          <span style={{ color: C.navy, fontWeight: 800, fontSize: '.75rem', whiteSpace: 'nowrap', flexShrink: 0, letterSpacing: '.05em' }}>📢 NOTICE:</span>
          <div style={{ overflow: 'hidden', flex: 1 }}>
            <div style={{ whiteSpace: 'nowrap', animation: 'dps-ticker 30s linear infinite', display: 'inline-block', color: C.navy, fontSize: '.8rem', fontWeight: 600 }}>
              {announcements.map(a => a.title).join('   •   ')}
            </div>
          </div>
          <style>{`@keyframes dps-ticker { from { transform: translateX(100%) } to { transform: translateX(-100%) } }`}</style>
        </div>
      )}
    </div>
  )
}

// ── About ─────────────────────────────────────────────────────────────────────
function About() {
  const cards = [
    { icon: '🎯', title: 'Our Mission', body: 'To provide holistic, value-based English medium education under the CBSE framework, empowering every student to achieve academic excellence and grow as responsible citizens.' },
    { icon: '🌟', title: 'Our Vision', body: 'To be Ranchi\'s most trusted school — where every child is seen, supported, and inspired to realise their fullest potential through disciplined learning and character-building.' },
    { icon: '🤝', title: 'Our Values', body: 'Integrity, discipline, curiosity, and compassion form the bedrock of our school culture. We celebrate diversity and nurture leadership from the earliest grades.' },
  ]
  return (
    <Section id="about" bg={C.cream}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: '2rem', alignItems: 'start' }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <SectionHead label="About Us" title="A School Built on Purpose" sub="Founded in Mesra, Ranchi, Daffodils Public School has been shaping young minds through quality CBSE education, modern facilities, and a nurturing environment." />
        </div>

        <div>
          <ImgPlaceholder label="School Building — Front View" ratio={65} radius={12} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {cards.map(c => (
            <div key={c.title} style={{ background: C.white, borderRadius: 10, padding: '1.25rem', border: `1px solid ${C.creamDk}`, boxShadow: '0 2px 8px rgba(0,0,0,.04)' }}>
              <div style={{ fontSize: '1.5rem', marginBottom: '.5rem' }}>{c.icon}</div>
              <div style={{ fontWeight: 700, color: C.navy, marginBottom: '.35rem', fontSize: '.95rem' }}>{c.title}</div>
              <p style={{ color: C.gray600, fontSize: '.85rem', lineHeight: 1.7, margin: 0 }}>{c.body}</p>
            </div>
          ))}
        </div>
      </div>
    </Section>
  )
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function Stats() {
  const items = [
    { num: '10+', label: 'Years of Excellence' },
    { num: '1000+', label: 'Students Enrolled' },
    { num: '60+', label: 'Qualified Teachers' },
    { num: '95%', label: 'Board Pass Rate' },
  ]
  return (
    <div style={{ background: `linear-gradient(135deg, ${C.navy}, ${C.navyDk})`, fontFamily: FONT }}>
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '3rem 1.25rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: '1.5rem' }}>
        {items.map(s => (
          <div key={s.label} style={{ textAlign: 'center', padding: '1.5rem', borderRight: `1px solid rgba(255,255,255,.1)` }}>
            <div style={{ fontSize: 'clamp(2rem,4vw,2.8rem)', fontWeight: 900, color: C.gold, lineHeight: 1 }}>{s.num}</div>
            <div style={{ color: 'rgba(255,255,255,.65)', fontSize: '.8rem', fontWeight: 600, marginTop: '.4rem', letterSpacing: '.03em', textTransform: 'uppercase' }}>{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Why Us ────────────────────────────────────────────────────────────────────
function WhyUs() {
  const items = [
    { icon: '🖥️', title: 'Smart Classrooms', body: 'Interactive digital boards and ICT-enabled learning in every classroom.' },
    { icon: '🔬', title: 'Modern Laboratories', body: 'Fully-equipped Physics, Chemistry, Biology and Computer labs.' },
    { icon: '📚', title: 'Rich Library', body: 'Thousands of volumes across subjects, with digital catalogue access.' },
    { icon: '🏃', title: 'Sports & Athletics', body: 'Large playgrounds, cricket, football, badminton and athletics programmes.' },
    { icon: '🎨', title: 'Arts & Culture', body: 'Music, dance, painting, and theatre nurture creativity alongside academics.' },
    { icon: '🚌', title: 'Safe Transport', body: 'GPS-tracked school buses covering all major routes in Ranchi.' },
  ]
  return (
    <Section id="facilities" bg={C.white}>
      <SectionHead label="Why Choose Us" title="Everything a Great School Should Be" sub="We combine academic rigour with co-curricular breadth so every child discovers their strengths." />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(250px,1fr))', gap: '1.25rem' }}>
        {items.map(i => (
          <div key={i.title} style={{
            background: C.cream, borderRadius: 12, padding: '1.5rem',
            border: `1px solid ${C.creamDk}`, transition: 'transform .2s, box-shadow .2s',
          }}
            onMouseOver={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = `0 8px 24px rgba(28,43,74,.1)` }}
            onMouseOut={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '' }}>
            <div style={{ fontSize: '2rem', marginBottom: '.75rem' }}>{i.icon}</div>
            <div style={{ fontWeight: 700, color: C.navy, marginBottom: '.35rem', fontSize: '1rem' }}>{i.title}</div>
            <p style={{ color: C.gray600, fontSize: '.85rem', lineHeight: 1.7, margin: 0 }}>{i.body}</p>
          </div>
        ))}
      </div>
    </Section>
  )
}

// ── Principal's Message ───────────────────────────────────────────────────────
function PrincipalMessage() {
  return (
    <Section bg={C.creamDk}>
      <SectionHead label="Leadership" title="Principal's Message" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: '3rem', alignItems: 'center' }}>
        <div>
          <ImgPlaceholder label="Principal's Photo" ratio={110} radius={12} />
          <div style={{ textAlign: 'center', marginTop: '1rem' }}>
            <div style={{ fontWeight: 700, color: C.navy, fontSize: '1rem' }}>Mr. / Ms. [Name]</div>
            <div style={{ color: C.gold, fontSize: '.8rem', fontWeight: 600 }}>Principal, Daffodils Public School</div>
          </div>
        </div>
        <div>
          <div style={{ fontSize: '3rem', color: C.gold, lineHeight: 1, marginBottom: '.5rem', fontFamily: 'Georgia, serif' }}>"</div>
          <p style={{ color: C.gray600, fontSize: '1rem', lineHeight: 1.8, margin: '0 0 1rem', fontStyle: 'italic' }}>
            At Daffodils Public School, we believe that every child is a unique gift. Our role as educators is not merely to transfer knowledge, but to ignite curiosity, build character, and prepare students for the challenges and opportunities of the 21st century.
          </p>
          <p style={{ color: C.gray600, fontSize: '1rem', lineHeight: 1.8, margin: '0 0 1.5rem', fontStyle: 'italic' }}>
            Our dedicated faculty, modern infrastructure, and vibrant co-curricular programme ensure that each student leaves our school not just with a certificate, but with confidence, compassion, and a hunger to keep learning.
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
  const streams = [
    { grade: 'Pre-Primary', range: 'Nursery · LKG · UKG', color: '#FEF3C7', border: '#FCD34D', icon: '🌱' },
    { grade: 'Primary', range: 'Class I — V', color: '#DBEAFE', border: '#93C5FD', icon: '📖' },
    { grade: 'Middle School', range: 'Class VI — VIII', color: '#D1FAE5', border: '#6EE7B7', icon: '🔬' },
    { grade: 'Secondary', range: 'Class IX — X', color: '#EDE9FE', border: '#C4B5FD', icon: '📐' },
    { grade: 'Senior Secondary', range: 'Class XI — XII', color: '#FCE7F3', border: '#F9A8D4', icon: '🎓' },
  ]
  return (
    <Section id="academics" bg={C.white}>
      <SectionHead label="Academics" title="Comprehensive CBSE Curriculum" sub="From Nursery through Senior Secondary, we offer a structured, age-appropriate learning pathway aligned with CBSE guidelines." />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '1rem', marginBottom: '2.5rem' }}>
        {streams.map(s => (
          <div key={s.grade} style={{ background: s.color, border: `1px solid ${s.border}`, borderRadius: 12, padding: '1.5rem 1rem', textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', marginBottom: '.5rem' }}>{s.icon}</div>
            <div style={{ fontWeight: 700, color: C.navy, fontSize: '.9rem', marginBottom: '.25rem' }}>{s.grade}</div>
            <div style={{ color: C.gray600, fontSize: '.75rem' }}>{s.range}</div>
          </div>
        ))}
      </div>
      <div style={{ background: C.navy, borderRadius: 12, padding: '1.5rem 2rem', display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
        <div style={{ color: C.gold, fontSize: '1.5rem' }}>🏛️</div>
        <div style={{ flex: 1 }}>
          <div style={{ color: C.white, fontWeight: 700, marginBottom: '.2rem' }}>CBSE Affiliated School</div>
          <div style={{ color: 'rgba(255,255,255,.65)', fontSize: '.82rem' }}>Daffodils Public School is affiliated to the Central Board of Secondary Education (CBSE), New Delhi — affiliation no. [XXXXXXXX]</div>
        </div>
      </div>
    </Section>
  )
}

// ── Gallery ───────────────────────────────────────────────────────────────────
function Gallery() {
  const photos = [
    'School Building — Main Block',
    'School Assembly Ground',
    'Science Laboratory',
    'Computer Lab',
    'Library Reading Room',
    'Sports Ground',
    'Annual Day Celebration',
    'Classroom — Smart Board',
    'Students at Prayer',
  ]
  return (
    <Section id="gallery" bg={C.cream}>
      <SectionHead label="Gallery" title="Life at Daffodils" sub="A glimpse into our vibrant school community — from classrooms to the playground." />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: '.75rem' }}>
        {photos.map((p, i) => (
          <div key={i} style={{ position: 'relative', overflow: 'hidden', borderRadius: 10, cursor: 'pointer', transition: 'transform .2s' }}
            onMouseOver={e => { e.currentTarget.style.transform = 'scale(1.02)' }}
            onMouseOut={e => { e.currentTarget.style.transform = '' }}>
            <ImgPlaceholder label={p} ratio={i === 0 || i === 3 ? 70 : 62} radius={10} />
          </div>
        ))}
      </div>
    </Section>
  )
}

// ── Admissions ────────────────────────────────────────────────────────────────
function Admissions() {
  const steps = [
    { n: '01', title: 'Download Form', body: 'Collect the admission form from the school office or download it from our website.' },
    { n: '02', title: 'Submit Documents', body: 'Submit the filled form along with required documents — birth certificate, previous mark sheet, and passport photo.' },
    { n: '03', title: 'Entrance Assessment', body: 'Appear for a brief interaction / assessment as applicable for the class applied.' },
    { n: '04', title: 'Confirmation', body: 'Receive the admission letter and complete the fee payment to confirm enrolment.' },
  ]
  return (
    <Section id="admissions" bg={`linear-gradient(135deg, ${C.navy} 0%, ${C.maroon} 100%)`}>
      <SectionHead label="Admissions Open" title="Join the Daffodils Family" sub="We welcome applications for all classes, subject to seat availability. Admissions for the new academic session are open." />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '1.5rem', marginBottom: '3rem' }}>
        {steps.map(s => (
          <div key={s.n} style={{ background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 12, padding: '1.5rem' }}>
            <div style={{ color: C.gold, fontWeight: 900, fontSize: '1.5rem', marginBottom: '.5rem' }}>{s.n}</div>
            <div style={{ color: C.white, fontWeight: 700, marginBottom: '.35rem', fontSize: '.95rem' }}>{s.title}</div>
            <p style={{ color: 'rgba(255,255,255,.6)', fontSize: '.82rem', lineHeight: 1.65, margin: 0 }}>{s.body}</p>
          </div>
        ))}
      </div>
      <div style={{ textAlign: 'center' }}>
        <a href="tel:+91XXXXXXXXXX" style={{
          display: 'inline-block', background: C.gold, color: C.navy,
          borderRadius: 6, padding: '.9rem 2.5rem', fontFamily: FONT,
          fontWeight: 800, fontSize: '1rem', textDecoration: 'none', transition: 'background .2s',
        }}
          onMouseOver={e => { (e.currentTarget as HTMLElement).style.background = C.goldLt }}
          onMouseOut={e => { (e.currentTarget as HTMLElement).style.background = C.gold }}>
          Enquire About Admissions →
        </a>
        <p style={{ color: 'rgba(255,255,255,.5)', fontSize: '.78rem', marginTop: '.75rem' }}>
          Call us · Visit the school office · Mon – Sat, 9 AM to 4 PM
        </p>
      </div>
    </Section>
  )
}

// ── Contact ───────────────────────────────────────────────────────────────────
function Contact() {
  const info = [
    { icon: '📍', label: 'Address', lines: ['Daffodils Public School', 'Mesra, Ranchi — 835215', 'Jharkhand, India'] },
    { icon: '📞', label: 'Phone', lines: ['+91 XXXXX XXXXX', '+91 XXXXX XXXXX'] },
    { icon: '✉️', label: 'Email', lines: ['info@daffodilsranchi.edu.in', 'admissions@daffodilsranchi.edu.in'] },
    { icon: '🕐', label: 'Office Hours', lines: ['Monday – Saturday', '9:00 AM to 4:00 PM'] },
  ]
  return (
    <Section id="contact" bg={C.white}>
      <SectionHead label="Get in Touch" title="We'd Love to Hear From You" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: '3rem', alignItems: 'start' }}>
        {/* Info grid */}
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
            {info.map(i => (
              <div key={i.label} style={{ background: C.cream, borderRadius: 10, padding: '1.1rem', border: `1px solid ${C.creamDk}` }}>
                <div style={{ fontSize: '1.4rem', marginBottom: '.4rem' }}>{i.icon}</div>
                <div style={{ fontWeight: 700, color: C.navy, fontSize: '.8rem', marginBottom: '.4rem' }}>{i.label}</div>
                {i.lines.map(l => <div key={l} style={{ color: C.gray600, fontSize: '.8rem', lineHeight: 1.6 }}>{l}</div>)}
              </div>
            ))}
          </div>
        </div>

        {/* Map placeholder */}
        <div>
          <ImgPlaceholder label="Google Maps — Daffodils Public School, Mesra Ranchi" ratio={70} radius={12} />
          <a
            href="https://maps.google.com/?q=Mesra+Ranchi+Jharkhand"
            target="_blank" rel="noreferrer"
            style={{ display: 'block', textAlign: 'center', marginTop: '.75rem', color: C.navy, fontWeight: 600, fontSize: '.82rem', textDecoration: 'none' }}>
            Open in Google Maps ↗
          </a>
        </div>
      </div>
    </Section>
  )
}

// ── Footer ────────────────────────────────────────────────────────────────────
function Footer({ onStaffLogin, onParentLogin }: { onStaffLogin: () => void; onParentLogin: () => void }) {
  const year = new Date().getFullYear()
  return (
    <footer style={{ background: C.navyDk, color: 'rgba(255,255,255,.7)', fontFamily: FONT }}>
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '3rem 1.25rem 1.5rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '2rem' }}>
        {/* Brand */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', marginBottom: '1rem' }}>
            <div style={{ width: 38, height: 38, borderRadius: 8, background: `linear-gradient(135deg,${C.gold},${C.maroon})`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.white, fontWeight: 900, fontSize: '1.1rem', flexShrink: 0 }}>D</div>
            <div>
              <div style={{ color: C.white, fontWeight: 800, fontSize: '.88rem' }}>Daffodils Public School</div>
              <div style={{ color: C.gold, fontSize: '.62rem', fontWeight: 600, letterSpacing: '.05em' }}>MESRA, RANCHI</div>
            </div>
          </div>
          <p style={{ fontSize: '.8rem', lineHeight: 1.7, margin: 0, maxWidth: 240 }}>
            A CBSE-affiliated English medium school committed to holistic education and lifelong values.
          </p>
        </div>

        {/* Quick Links */}
        <div>
          <div style={{ color: C.gold, fontWeight: 700, fontSize: '.8rem', letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: '1rem' }}>Quick Links</div>
          {['About Us', 'Academics', 'Facilities', 'Gallery', 'Admissions', 'Contact'].map(l => (
            <div key={l} style={{ marginBottom: '.4rem' }}>
              <a href={`#${l.toLowerCase().replace(/\s+/g,'')}`} style={{ color: 'rgba(255,255,255,.65)', fontSize: '.82rem', textDecoration: 'none' }}
                onMouseOver={e => { (e.currentTarget as HTMLElement).style.color = C.gold }}
                onMouseOut={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,.65)' }}>
                {l}
              </a>
            </div>
          ))}
        </div>

        {/* Contact */}
        <div>
          <div style={{ color: C.gold, fontWeight: 700, fontSize: '.8rem', letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: '1rem' }}>Contact</div>
          <p style={{ fontSize: '.82rem', lineHeight: 1.8, margin: 0 }}>
            Mesra, Ranchi — 835215<br />
            Jharkhand, India<br />
            +91 XXXXX XXXXX<br />
            info@daffodilsranchi.edu.in
          </p>
        </div>

        {/* Portal Access */}
        <div>
          <div style={{ color: C.gold, fontWeight: 700, fontSize: '.8rem', letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: '1rem' }}>Portal Access</div>
          <button onClick={onParentLogin} style={{ display: 'block', background: 'rgba(201,162,39,.15)', border: `1px solid rgba(201,162,39,.3)`, color: C.gold, borderRadius: 6, padding: '.5rem 1rem', fontFamily: FONT, fontWeight: 600, fontSize: '.82rem', cursor: 'pointer', width: '100%', textAlign: 'left', marginBottom: '.5rem' }}>
            👨‍👩‍👧 Parent Portal
          </button>
          <button onClick={onStaffLogin} style={{ display: 'block', background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.12)', color: 'rgba(255,255,255,.75)', borderRadius: 6, padding: '.5rem 1rem', fontFamily: FONT, fontWeight: 600, fontSize: '.82rem', cursor: 'pointer', width: '100%', textAlign: 'left' }}>
            🏫 Staff Portal
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
export function PublicSite({
  onStaffLogin, onParentLogin,
}: {
  onStaffLogin: () => void
  onParentLogin: () => void
}) {
  const [schoolName, setSchoolName] = useState('')
  const [announcements, setAnnouncements] = useState<CmsAnnouncement[]>([])

  useEffect(() => {
    cmsPublic.schoolInfo().then(s => setSchoolName(s.name)).catch(() => {})
    cmsPublic.announcements().then(a => setAnnouncements(a.filter(x => x.is_published))).catch(() => {})
  }, [])

  return (
    <div style={{ fontFamily: FONT }}>
      <Navbar schoolName={schoolName} onStaffLogin={onStaffLogin} onParentLogin={onParentLogin} />
      <Hero schoolName={schoolName} announcements={announcements} />
      <About />
      <Stats />
      <WhyUs />
      <PrincipalMessage />
      <Academics />
      <Gallery />
      <Admissions />
      <Contact />
      <Footer onStaffLogin={onStaffLogin} onParentLogin={onParentLogin} />
    </div>
  )
}
