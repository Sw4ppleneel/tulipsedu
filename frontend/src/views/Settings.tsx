import { useEffect, useState } from 'preact/hooks'
import { settingsApi } from '../api/settings'

export function SettingsView() {
  const [upi, setUpi] = useState('')
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    settingsApi.get()
      .then((s) => { setUpi(s.upi_id ?? ''); setSaved(s.upi_id ?? null) })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [])

  async function save() {
    setBusy(true); setError('')
    try {
      const s = await settingsApi.setUpi(upi.trim() || null)
      setSaved(s.upi_id ?? null)
      setUpi(s.upi_id ?? '')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const INP: preact.JSX.CSSProperties = { padding: '0.5rem 0.625rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.875rem', width: 320, maxWidth: '100%' }

  return (
    <div style={{ padding: '1.5rem', fontFamily: 'system-ui, sans-serif', maxWidth: 560 }}>
      <h2 style={{ margin: '0 0 1rem', fontSize: '1.25rem', fontWeight: 700 }}>School Settings</h2>

      {loading ? <p style={{ color: '#9ca3af', fontSize: '0.875rem' }}>Loading…</p> : (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '1.25rem' }}>
          <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>UPI Payment ID</h4>
          <p style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', color: '#6b7280' }}>
            Parents pay fees by scanning a UPI QR generated from this ID. Format: <b>name@bank</b> (e.g. <code>school.name@okaxis</code>).
            Leave blank to disable online payment.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              value={upi}
              onInput={(e) => setUpi((e.target as HTMLInputElement).value)}
              placeholder="school.name@okaxis"
              style={INP}
            />
            <button
              onClick={save}
              disabled={busy}
              style={{ padding: '0.5rem 1.25rem', background: busy ? '#9ca3af' : '#1a56db', color: '#fff', border: 'none', borderRadius: 4, cursor: busy ? 'default' : 'pointer', fontSize: '0.875rem', fontWeight: 600 }}
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
          {error && <p style={{ color: '#c00', fontSize: '0.8rem', marginTop: '0.625rem' }}>{error}</p>}
          {!error && saved !== null && (
            <p style={{ color: '#059669', fontSize: '0.8rem', marginTop: '0.625rem' }}>
              ✓ Current UPI ID: <b>{saved}</b>
            </p>
          )}
          {!error && saved === null && !loading && (
            <p style={{ color: '#9ca3af', fontSize: '0.8rem', marginTop: '0.625rem' }}>No UPI ID set — online payment disabled.</p>
          )}
        </div>
      )}
    </div>
  )
}
