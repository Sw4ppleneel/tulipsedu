import { useState } from 'preact/hooks'
import { login } from './api/client'
import type { TokenResponse } from './types/auth'

const styles = {
  page: { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', fontFamily: 'system-ui, sans-serif', background: '#f5f5f5' },
  card: { width: '100%', maxWidth: '360px', background: '#fff', borderRadius: '8px', padding: '2rem', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' },
  heading: { margin: '0 0 1.5rem', fontSize: '1.5rem', fontWeight: 700, color: '#1a56db' },
  error: { color: '#c00', marginBottom: '1rem', fontSize: '0.875rem' },
  field: { marginBottom: '1rem' } as const,
  label: { display: 'block', marginBottom: '0.25rem', fontSize: '0.875rem', color: '#444' } as const,
  input: { width: '100%', padding: '0.625rem', border: '1px solid #ccc', borderRadius: '4px', fontSize: '1rem', boxSizing: 'border-box' } as const,
  button: { width: '100%', padding: '0.75rem', background: '#1a56db', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '1rem', cursor: 'pointer' } as const,
}

export function App() {
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [tokens, setTokens] = useState<TokenResponse | null>(null)

  async function handleSubmit(e: Event) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      setTokens(await login({ phone_number: phone, password }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  if (tokens) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <h2 style={{ ...styles.heading, color: '#15803d' }}>Authenticated</h2>
          <p style={{ fontSize: '0.875rem', color: '#666', marginBottom: '0.5rem' }}>Dashboard coming soon.</p>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.page}>
      <form onSubmit={handleSubmit} style={styles.card}>
        <h1 style={styles.heading}>Tulips.edu</h1>
        {error && <p style={styles.error}>{error}</p>}
        <div style={styles.field}>
          <label style={styles.label}>Phone number</label>
          <input
            type="tel"
            value={phone}
            onInput={(e) => setPhone((e.target as HTMLInputElement).value)}
            style={styles.input}
            placeholder="9999999999"
            required
          />
        </div>
        <div style={{ ...styles.field, marginBottom: '1.5rem' }}>
          <label style={styles.label}>Password</label>
          <input
            type="password"
            value={password}
            onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
            style={styles.input}
            required
          />
        </div>
        <button type="submit" disabled={loading} style={styles.button}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
