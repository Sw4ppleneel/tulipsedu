import { useEffect, useState } from 'preact/hooks'
import { cmsPublic } from '../api/cms'

export function PublicSite({
  onStaffLogin, onParentLogin,
}: {
  onStaffLogin: () => void
  onParentLogin: () => void
}) {
  const [name, setName] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    cmsPublic.schoolInfo()
      .then(s => setName(s.name))
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  const initial = (name || 'T').charAt(0).toUpperCase()

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', textAlign: 'center',
      padding: '2rem 1.25rem', fontFamily: 'system-ui, -apple-system, sans-serif',
      background: 'linear-gradient(160deg, #eff6ff 0%, #f0fdf4 55%, #fafafa 100%)',
      color: '#1f2937',
    }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', maxWidth: 560 }}>
        {/* Crest */}
        <div style={{
          width: 76, height: 76, borderRadius: 20,
          background: 'linear-gradient(135deg,#1a56db,#1e40af)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontWeight: 900, fontSize: '2rem',
          boxShadow: '0 10px 30px rgba(26,86,219,.3)', marginBottom: '1.5rem',
        }}>
          {initial}
        </div>

        {/* School name */}
        <h1 style={{ fontSize: '2rem', fontWeight: 800, margin: '0 0 .5rem', lineHeight: 1.15, color: '#111827' }}>
          {loaded ? (name || 'Our School') : ' '}
        </h1>

        {/* Pill */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '.4rem',
          background: 'rgba(26,86,219,.1)', color: '#1a56db',
          borderRadius: 9999, padding: '.35rem .9rem', fontSize: '.78rem', fontWeight: 600,
          margin: '.5rem 0 1.25rem',
        }}>
          <span style={{ width: 7, height: 7, borderRadius: 9999, background: '#1a56db' }} />
          Coming soon
        </div>

        <p style={{ fontSize: '1.15rem', fontWeight: 600, margin: '0 0 .5rem', color: '#1f2937' }}>
          Something exciting is on its way ✨
        </p>
        <p style={{ fontSize: '.95rem', color: '#6b7280', margin: 0, lineHeight: 1.6 }}>
          We're building a brand-new home online for our school community.
          Check back soon.
        </p>
      </div>

      {/* Discreet login access for staff & parents */}
      <footer style={{ paddingBottom: '1.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.6rem' }}>
        <div style={{ display: 'flex', gap: '1.25rem' }}>
          <button onClick={onParentLogin} style={{ background: 'none', border: 'none', color: '#1a56db', cursor: 'pointer', fontSize: '.85rem', fontWeight: 600, fontFamily: 'inherit' }}>
            Parent Login
          </button>
          <button onClick={onStaffLogin} style={{ background: 'none', border: 'none', color: '#1a56db', cursor: 'pointer', fontSize: '.85rem', fontWeight: 600, fontFamily: 'inherit' }}>
            Staff Login
          </button>
        </div>
        <span style={{ fontSize: '.7rem', color: '#9ca3af' }}>Powered by Tulips.edu</span>
      </footer>
    </div>
  )
}
