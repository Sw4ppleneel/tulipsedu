import { schoolSlug } from '../assets'
import { DaffodilsPublicSchool } from './public/DaffodilsPublicSchool'
import { PremchandMahtoInterCollege } from './public/PremchandMahtoInterCollege'
import { PremchandHighSchool } from './public/PremchandHighSchool'

interface Props {
  onStaffLogin: () => void
  onParentLogin: () => void
}

// Each school has its own site component with its own design, colours, and content.
// Add a new entry here when onboarding a new school.
const SCHOOL_SITES: Record<string, (props: Props) => preact.JSX.Element> = {
  daffodilspublicschool: DaffodilsPublicSchool,
  premchandmahtoic: PremchandMahtoInterCollege,
  premchandhighschool: PremchandHighSchool,
}

// Fallback for slugs not yet mapped to a dedicated site.
function UnknownSchool({ onStaffLogin }: Props) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif', background: '#f8f8f8', gap: 16, padding: '2rem' }}>
      <div style={{ fontSize: '2.5rem' }}>🌷</div>
      <h1 style={{ margin: 0, fontSize: '1.5rem', color: '#1a1a2e' }}>Tulips.edu</h1>
      <p style={{ color: '#555', margin: 0 }}>This school's website is being set up. Please check back soon.</p>
      <button onClick={onStaffLogin} style={{ marginTop: 12, padding: '.55rem 1.4rem', background: '#1C2B4A', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
        Staff / Admin Login
      </button>
    </div>
  )
}

export function PublicSite(props: Props) {
  const slug = schoolSlug()
  const Site = SCHOOL_SITES[slug] ?? UnknownSchool
  return <Site {...props} />
}
