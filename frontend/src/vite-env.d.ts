/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL for per-school website assets. Default '/school-assets' (local
   *  public dir); set to the R2/CDN base in production, e.g.
   *  https://cdn.tulipsedu.in/school-assets */
  readonly VITE_SCHOOL_ASSET_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
