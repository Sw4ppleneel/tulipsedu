import { useRef, useState } from 'preact/hooks'
import { getAuthState } from '../api/auth_state'

/**
 * Bulk .xlsx import control. Posts the file as multipart/form-data to an existing
 * import endpoint (auth header set manually since the JSON client can't carry a
 * file body). Shows created/updated/errors. Reused by Students and Staff.
 */
export function ExcelImport({
  endpoint, query, columns, onImported, disabledReason,
}: {
  endpoint: string
  query?: Record<string, string | undefined>
  columns: string
  onImported: () => void
  disabledReason?: string
}) {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const [err, setErr] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  async function run() {
    if (!file) return
    setBusy(true); setErr(''); setResult('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const qs = query
        ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v) as [string, string][]).toString()
        : ''
      const auth = getAuthState()
      const res = await fetch(`/api/v1${endpoint}${qs}`, {
        method: 'POST',
        headers: auth ? { Authorization: `Bearer ${auth.accessToken}`, 'X-Tenant-Slug': auth.tenantSlug } : {},
        body: fd,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(data.detail || 'Import failed'); return }
      const parts = [`${data.created ?? 0} added`, `${data.updated ?? 0} updated`]
      if (typeof data.users_created === 'number') parts.push(`${data.users_created} logins created`)
      setResult(parts.join(' · ') + ((data.errors?.length) ? ` · ${data.errors.length} row error(s)` : ''))
      if (data.errors?.length) setErr(data.errors.slice(0, 5).join('\n'))
      setFile(null)
      if (inputRef.current) inputRef.current.value = ''
      onImported()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Import failed')
    } finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'inline-block' }}>
      <button class="btn btn-ghost btn-sm" onClick={() => setOpen(o => !o)}>Import Excel</button>
      {open && (
        <div class="card card-pad" style={{ position: 'absolute', right: '1.25rem', marginTop: '.5rem', zIndex: 50, width: 320, boxShadow: 'var(--shadow-md)' }}>
          <div style={{ fontWeight: 700, fontFamily: 'var(--font-display)', marginBottom: '.4rem' }}>Import from .xlsx</div>
          <p class="text-xs text-muted" style={{ marginBottom: '.6rem' }}>
            First row must be a header with columns:<br /><b style={{ color: 'var(--gray-700)' }}>{columns}</b>
          </p>
          {disabledReason ? (
            <p class="text-xs" style={{ color: 'var(--c-warn)' }}>{disabledReason}</p>
          ) : (
            <>
              <input ref={inputRef} type="file" accept=".xlsx"
                onChange={e => setFile((e.target as HTMLInputElement).files?.[0] ?? null)}
                class="text-xs" style={{ marginBottom: '.6rem', width: '100%' }} />
              <div style={{ display: 'flex', gap: '.5rem' }}>
                <button class="btn btn-primary btn-sm" disabled={!file || busy} onClick={run}>
                  {busy ? 'Importing…' : 'Import'}
                </button>
                <button class="btn btn-ghost btn-sm" onClick={() => { setOpen(false); setResult(''); setErr('') }}>Close</button>
              </div>
            </>
          )}
          {result && <p class="text-xs" style={{ color: 'var(--c-success)', marginTop: '.6rem', fontWeight: 600 }}>✓ {result}</p>}
          {err && <pre class="text-xs" style={{ color: 'var(--c-danger)', marginTop: '.5rem', whiteSpace: 'pre-wrap', fontFamily: 'var(--font)' }}>{err}</pre>}
        </div>
      )}
    </div>
  )
}
