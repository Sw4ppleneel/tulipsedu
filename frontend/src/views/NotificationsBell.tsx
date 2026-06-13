import { useEffect, useRef, useState } from 'preact/hooks'
import { notificationsApi, type AppNotification } from '../api/notifications'

// Gentler than FeesAdmin's 3s precedent — staff alerts aren't time-critical.
const POLL_MS = 45000

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function NotificationsBell() {
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  async function refreshCount() {
    try { setUnread((await notificationsApi.unreadCount()).unread) } catch { /* offline — keep last */ }
  }
  async function loadList() {
    setLoading(true)
    try { setItems(await notificationsApi.list()) } catch { /* keep last */ } finally { setLoading(false) }
  }

  // Poll + refetch on focus/visibility (cheap, no sockets).
  useEffect(() => {
    refreshCount()
    const t = setInterval(refreshCount, POLL_MS)
    const onFocus = () => refreshCount()
    const onVis = () => { if (!document.hidden) refreshCount() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  // Close dropdown on outside click.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next) await loadList()
  }

  async function markAll() {
    try {
      await notificationsApi.markAllRead()
      const now = new Date().toISOString()
      setItems(prev => prev.map(i => ({ ...i, read_at: i.read_at ?? now })))
      setUnread(0)
    } catch { /* ignore */ }
  }

  async function tap(n: AppNotification) {
    if (n.read_at) return
    try { await notificationsApi.markRead(n.id) } catch { /* ignore */ }
    const now = new Date().toISOString()
    setItems(prev => prev.map(i => (i.id === n.id ? { ...i, read_at: now } : i)))
    setUnread(u => Math.max(0, u - 1))
  }

  return (
    <div ref={boxRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={toggle}
        title="Notifications"
        style={{
          position: 'relative', background: 'rgba(255,255,255,.12)',
          color: 'rgba(255,255,255,.9)', border: '1px solid rgba(255,255,255,.2)',
          borderRadius: 5, padding: '.3rem .55rem', cursor: 'pointer',
          fontSize: '.95rem', fontFamily: 'inherit', lineHeight: 1,
        }}
      >
        🔔
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: -6, right: -6, minWidth: 16, height: 16,
            padding: '0 4px', background: '#ef4444', color: '#fff', borderRadius: 8,
            fontSize: '.6rem', fontWeight: 700, display: 'flex', alignItems: 'center',
            justifyContent: 'center', boxShadow: '0 1px 3px rgba(0,0,0,.3)',
          }}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 320,
          maxHeight: 420, overflowY: 'auto', background: '#fff',
          color: 'var(--gray-900)', borderRadius: 10,
          boxShadow: '0 8px 28px rgba(0,0,0,.18)', border: '1px solid var(--gray-200, #e5e7eb)',
          zIndex: 200,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '.6rem .8rem', borderBottom: '1px solid var(--gray-100, #f3f4f6)',
            position: 'sticky', top: 0, background: '#fff',
          }}>
            <strong style={{ fontSize: '.8rem' }}>Notifications</strong>
            {items.some(i => !i.read_at) && (
              <button onClick={markAll} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: '#14463A', fontSize: '.72rem', fontFamily: 'inherit', padding: 0,
              }}>
                Mark all read
              </button>
            )}
          </div>

          {loading && items.length === 0 ? (
            <div style={{ padding: '1.25rem', textAlign: 'center', fontSize: '.78rem', color: 'var(--gray-500)' }}>Loading…</div>
          ) : items.length === 0 ? (
            <div style={{ padding: '1.5rem 1rem', textAlign: 'center', fontSize: '.78rem', color: 'var(--gray-500)' }}>
              No notifications yet
            </div>
          ) : (
            items.map(n => (
              <div
                key={n.id}
                onClick={() => tap(n)}
                style={{
                  padding: '.6rem .8rem', borderBottom: '1px solid var(--gray-100, #f3f4f6)',
                  cursor: n.read_at ? 'default' : 'pointer',
                  background: n.read_at ? '#fff' : 'rgba(20,70,58,.04)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '.5rem' }}>
                  {!n.read_at && <span style={{ width: 7, height: 7, borderRadius: 4, background: '#14463A', flexShrink: 0 }} />}
                  <span style={{ fontWeight: 600, fontSize: '.78rem', flex: 1 }}>{n.title}</span>
                  <span style={{ fontSize: '.66rem', color: 'var(--gray-400)', flexShrink: 0 }}>{ago(n.created_at)}</span>
                </div>
                {n.body && <div style={{ fontSize: '.72rem', color: 'var(--gray-600)', marginTop: '.15rem', paddingLeft: n.read_at ? 0 : '1rem' }}>{n.body}</div>}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
