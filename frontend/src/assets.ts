import { publicSlug } from './api/cms'

// Base URL for per-school website assets (logos, hero, gallery photos).
//  - Default '/school-assets' → served from frontend/public/school-assets/<slug>/
//  - Production: set VITE_SCHOOL_ASSET_BASE to the R2/CDN base, e.g.
//    https://cdn.tulipsedu.in/school-assets
// See frontend/public/school-assets/README.md for the full convention.
const ASSET_BASE = (import.meta.env.VITE_SCHOOL_ASSET_BASE ?? '/school-assets').replace(/\/+$/, '')

/** Resolve a per-school asset URL: `<base>/<slug>/<file>`. */
export function schoolAsset(slug: string, file: string): string {
  return `${ASSET_BASE}/${slug}/${file}`
}

/** Current tenant slug (subdomain in prod, ?school= override in dev). */
export { publicSlug as schoolSlug }
