import { useEffect, useState } from 'preact/hooks'
import { settingsApi } from '../api/settings'
import { listAcademicYears, createAcademicYear, rolloverYear } from '../api/students'
import type { AcademicYear } from '../types/student'

// ── UPI Settings ──────────────────────────────────────────────────────────────
function UpiPanel() {
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
    } finally { setBusy(false) }
  }

  const INP: preact.JSX.CSSProperties = { padding: '0.5rem 0.625rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.875rem', width: 320, maxWidth: '100%' }

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '1.25rem', marginBottom: '1.25rem' }}>
      <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>UPI Payment ID</h4>
      <p style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', color: '#6b7280' }}>
        Parents pay fees by scanning a UPI QR generated from this ID. Format: <b>name@bank</b> (e.g. <code>school.name@okaxis</code>).
        Leave blank to disable online payment.
      </p>
      {loading ? <p style={{ color: '#9ca3af', fontSize: '0.8rem' }}>Loading…</p> : (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input value={upi} onInput={(e) => setUpi((e.target as HTMLInputElement).value)} placeholder="school.name@okaxis" style={INP} />
          <button onClick={save} disabled={busy} style={{ padding: '0.5rem 1.25rem', background: busy ? '#9ca3af' : '#14463A', color: '#fff', border: 'none', borderRadius: 4, cursor: busy ? 'default' : 'pointer', fontSize: '0.875rem', fontWeight: 600 }}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
      {error && <p style={{ color: '#c00', fontSize: '0.8rem', marginTop: '0.625rem' }}>{error}</p>}
      {!error && saved !== null && !loading && <p style={{ color: '#1F8A5D', fontSize: '0.8rem', marginTop: '0.625rem' }}>✓ Current UPI ID: <b>{saved}</b></p>}
      {!error && saved === null && !loading && <p style={{ color: '#9ca3af', fontSize: '0.8rem', marginTop: '0.625rem' }}>No UPI ID set — online payment disabled.</p>}
    </div>
  )
}

// ── Academic Year Rollover ────────────────────────────────────────────────────
function RolloverPanel() {
  const [years, setYears] = useState<AcademicYear[]>([])
  const [loading, setLoading] = useState(true)
  const [toYearId, setToYearId] = useState('')
  const [newYearName, setNewYearName] = useState('')
  const [newStart, setNewStart] = useState('')
  const [newEnd, setNewEnd] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ archived_year: string; new_current_year: string; fee_rows_carried: number; timetable_slots_cloned: number } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    listAcademicYears().then(setYears).finally(() => setLoading(false))
  }, [])

  const currentYear = years.find((y) => y.is_current)
  const activeYears = years.filter((y) => y.status !== 'archived' && !y.is_current)

  async function createAndSelect() {
    if (!newYearName.trim() || !newStart || !newEnd) return
    setBusy(true); setError('')
    try {
      const y = await createAcademicYear({ name: newYearName.trim(), start_date: newStart, end_date: newEnd })
      const ys = await listAcademicYears()
      setYears(ys)
      setToYearId(y.id)
      setNewYearName(''); setNewStart(''); setNewEnd('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to create year') }
    finally { setBusy(false) }
  }

  async function doRollover() {
    if (!currentYear || !toYearId) return
    setBusy(true); setError(''); setConfirming(false)
    try {
      const r = await rolloverYear(currentYear.id, toYearId)
      setResult(r)
      const ys = await listAcademicYears()
      setYears(ys)
    } catch (e) { setError(e instanceof Error ? e.message : 'Rollover failed') }
    finally { setBusy(false) }
  }

  const INP: preact.JSX.CSSProperties = { padding: '0.5rem 0.625rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.875rem' }

  if (loading) return <p style={{ color: '#9ca3af', fontSize: '0.8rem' }}>Loading…</p>

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '1.25rem' }}>
      <h4 style={{ margin: '0 0 0.375rem', fontSize: '0.95rem' }}>Academic Year Rollover</h4>
      <p style={{ margin: '0 0 1rem', fontSize: '0.8rem', color: '#6b7280' }}>
        Archives the current year, promotes a new year as current, carries forward unpaid fees, and clones the timetable.
        Student class promotion must be done manually in Student Management.
      </p>

      {result ? (
        <div style={{ padding: '1rem', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 6, fontSize: '0.8rem', color: '#065f46' }}>
          <div style={{ fontWeight: 700, marginBottom: '0.375rem' }}>✓ Rollover complete</div>
          <div>Archived: <b>{result.archived_year}</b> → New current year: <b>{result.new_current_year}</b></div>
          <div>{result.fee_rows_carried} fee rows carried forward · {result.timetable_slots_cloned} timetable slots cloned</div>
        </div>
      ) : (
        <>
          <div style={{ marginBottom: '0.875rem', padding: '0.75rem', background: '#f9fafb', borderRadius: 6, fontSize: '0.8rem' }}>
            <span style={{ fontWeight: 600 }}>Current year: </span>
            {currentYear ? <span style={{ color: '#14463A' }}>{currentYear.name} ({currentYear.start_date} → {currentYear.end_date})</span> : <span style={{ color: '#9ca3af' }}>None</span>}
          </div>

          {/* Create new year */}
          <div style={{ marginBottom: '1rem' }}>
            <p style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.5rem', color: '#374151' }}>1. Create or select the next academic year</p>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <input value={newYearName} onInput={(e) => setNewYearName((e.target as HTMLInputElement).value)} placeholder="Name e.g. 2026-2027" style={{ ...INP, width: 140 }} />
              <input type="date" value={newStart} onInput={(e) => setNewStart((e.target as HTMLInputElement).value)} style={{ ...INP, width: 140 }} />
              <input type="date" value={newEnd} onInput={(e) => setNewEnd((e.target as HTMLInputElement).value)} style={{ ...INP, width: 140 }} />
              <button onClick={createAndSelect} disabled={busy || !newYearName || !newStart || !newEnd}
                style={{ padding: '0.5rem 1rem', background: '#14463A', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' }}>
                Create &amp; Select
              </button>
            </div>
          </div>

          {/* Select existing year */}
          {activeYears.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <p style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.375rem' }}>Or pick an existing year:</p>
              <select value={toYearId} onChange={(e) => setToYearId((e.target as HTMLSelectElement).value)} style={{ ...INP, width: 280 }}>
                <option value="">Select target year</option>
                {activeYears.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
              </select>
            </div>
          )}

          {/* Rollover action */}
          <div style={{ marginTop: '0.5rem' }}>
            <p style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.5rem', color: '#374151' }}>2. Start rollover</p>
            {!confirming ? (
              <button
                onClick={() => setConfirming(true)}
                disabled={!toYearId || !currentYear}
                style={{ padding: '0.5rem 1.25rem', background: (!toYearId || !currentYear) ? '#9ca3af' : '#dc2626', color: '#fff', border: 'none', borderRadius: 4, cursor: (!toYearId || !currentYear) ? 'default' : 'pointer', fontSize: '0.875rem', fontWeight: 600 }}>
                Begin Rollover →
              </button>
            ) : (
              <div style={{ padding: '1rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6 }}>
                <p style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', fontWeight: 600, color: '#991b1b' }}>
                  This will archive <b>{currentYear?.name}</b> and set <b>{years.find(y => y.id === toYearId)?.name}</b> as current. This cannot be undone.
                </p>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button onClick={doRollover} disabled={busy} style={{ padding: '0.5rem 1.25rem', background: busy ? '#9ca3af' : '#dc2626', color: '#fff', border: 'none', borderRadius: 4, cursor: busy ? 'default' : 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>
                    {busy ? 'Rolling over…' : 'Confirm Rollover'}
                  </button>
                  <button onClick={() => setConfirming(false)} style={{ padding: '0.5rem 1rem', background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {error && <p style={{ color: '#c00', fontSize: '0.8rem', marginTop: '0.75rem' }}>{error}</p>}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function SettingsView() {
  return (
    <div style={{ padding: '1.5rem', fontFamily: 'system-ui, sans-serif', maxWidth: 640 }}>
      <h2 style={{ margin: '0 0 1rem', fontSize: '1.25rem', fontWeight: 700 }}>School Settings</h2>
      <UpiPanel />
      <RolloverPanel />
    </div>
  )
}
