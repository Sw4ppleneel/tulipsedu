import { useEffect, useState } from 'preact/hooks'
import { cmsAdmin } from '../api/cms'
import type { CmsAnnouncement, CmsPage } from '../api/cms'

const INP: preact.JSX.CSSProperties = {
  width: '100%', padding: '0.5rem', border: '1px solid #d1d5db',
  borderRadius: 4, fontSize: '0.875rem', boxSizing: 'border-box',
}
const LBL: preact.JSX.CSSProperties = {
  display: 'block', fontSize: '0.75rem', fontWeight: 600,
  color: '#374151', marginBottom: '0.25rem',
}

// ── Page Editor ──────────────────────────────────────────────────────────────

function PageEditor({
  initial, onSave, onCancel,
}: {
  initial?: Partial<CmsPage>
  onSave: (d: { slug: string; title: string; content_html: string; meta_description: string; is_published: boolean; sort_order: number }) => Promise<void>
  onCancel: () => void
}) {
  const [slug, setSlug] = useState(initial?.slug ?? '')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [html, setHtml] = useState(initial?.content_html ?? '')
  const [meta, setMeta] = useState(initial?.meta_description ?? '')
  const [pub, setPub] = useState(initial?.is_published ?? false)
  const [order, setOrder] = useState(initial?.sort_order ?? 0)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e: Event) {
    e.preventDefault()
    if (!slug || !title) { setErr('Slug and title are required'); return }
    setSaving(true); setErr('')
    try {
      await onSave({ slug: slug.trim(), title, content_html: html, meta_description: meta, is_published: pub, sort_order: order })
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Error')
    } finally { setSaving(false) }
  }

  return (
    <form onSubmit={submit} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '1.25rem', marginBottom: '1rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <div>
          <label style={LBL}>Slug * <span style={{ fontWeight: 400, color: '#9ca3af' }}>(URL path)</span></label>
          <input value={slug} onInput={e => setSlug((e.target as HTMLInputElement).value.toLowerCase().replace(/\s+/g, '-'))} style={INP} placeholder="about-us" disabled={!!initial?.id} />
        </div>
        <div>
          <label style={LBL}>Sort Order</label>
          <input type="number" value={order} onInput={e => setOrder(Number((e.target as HTMLInputElement).value))} style={INP} />
        </div>
      </div>
      <div style={{ marginBottom: '0.75rem' }}>
        <label style={LBL}>Title *</label>
        <input value={title} onInput={e => setTitle((e.target as HTMLInputElement).value)} style={INP} placeholder="About Us" />
      </div>
      <div style={{ marginBottom: '0.75rem' }}>
        <label style={LBL}>Content (HTML)</label>
        <textarea value={html} onInput={e => setHtml((e.target as HTMLTextAreaElement).value)} style={{ ...INP, height: 160, resize: 'vertical', fontFamily: 'monospace', fontSize: '0.8rem' }} placeholder="<p>Page content…</p>" />
      </div>
      <div style={{ marginBottom: '0.75rem' }}>
        <label style={LBL}>Meta Description</label>
        <input value={meta} onInput={e => setMeta((e.target as HTMLInputElement).value)} style={INP} placeholder="Short description for search engines" />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <input type="checkbox" id="pub-page" checked={pub} onChange={e => setPub((e.target as HTMLInputElement).checked)} />
        <label for="pub-page" style={{ fontSize: '0.875rem', cursor: 'pointer' }}>Published</label>
      </div>
      {err && <p style={{ color: '#ef4444', fontSize: '0.8rem', marginBottom: '0.5rem' }}>{err}</p>}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button type="submit" disabled={saving} style={{ padding: '0.5rem 1.25rem', background: '#14463A', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem' }}>
          {saving ? 'Saving…' : 'Save Page'}
        </button>
        <button type="button" onClick={onCancel} style={{ padding: '0.5rem 1rem', background: 'none', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem', color: '#374151' }}>Cancel</button>
      </div>
    </form>
  )
}

// ── Pages Tab ────────────────────────────────────────────────────────────────

function PagesTab() {
  const [pages, setPages] = useState<CmsPage[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<CmsPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  async function load() {
    setLoading(true)
    try { setPages(await cmsAdmin.listPages()) }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function handleCreate(d: Parameters<typeof cmsAdmin.createPage>[0]) {
    await cmsAdmin.createPage(d); setShowForm(false); load()
  }

  async function handleUpdate(id: string, d: Parameters<typeof cmsAdmin.updatePage>[1]) {
    await cmsAdmin.updatePage(id, d); setEditing(null); load()
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this page?')) return
    await cmsAdmin.deletePage(id); setPages(prev => prev.filter(p => p.id !== id))
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>{pages.length} page{pages.length !== 1 ? 's' : ''}</span>
        <button onClick={() => { setShowForm(s => !s); setEditing(null) }} style={{ padding: '0.4rem 1rem', background: '#14463A', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem' }}>
          {showForm ? 'Cancel' : '+ New Page'}
        </button>
      </div>
      {showForm && <PageEditor onSave={handleCreate} onCancel={() => setShowForm(false)} />}
      {editing && <PageEditor initial={editing} onSave={d => handleUpdate(editing.id, d)} onCancel={() => setEditing(null)} />}
      {err && <p style={{ color: '#ef4444', fontSize: '0.875rem' }}>{err}</p>}
      {loading && <p style={{ color: '#6b7280', fontSize: '0.875rem' }}>Loading…</p>}
      {pages.map(p => (
        <div key={p.id} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: '0.75rem 1rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#111827' }}>{p.title}</div>
            <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>/{p.slug} · order {p.sort_order}</div>
          </div>
          <span style={{ padding: '2px 8px', borderRadius: 9999, fontSize: '0.7rem', fontWeight: 600, background: p.is_published ? '#d1fae5' : '#f3f4f6', color: p.is_published ? '#0D332A' : '#6b7280' }}>
            {p.is_published ? 'PUBLISHED' : 'DRAFT'}
          </span>
          <button onClick={() => { setEditing(p); setShowForm(false) }} style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: 4, padding: '0.25rem 0.625rem', cursor: 'pointer', fontSize: '0.75rem', color: '#374151' }}>Edit</button>
          <button onClick={() => handleDelete(p.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: '1.1rem' }}>×</button>
        </div>
      ))}
      {!loading && pages.length === 0 && !showForm && (
        <p style={{ color: '#9ca3af', fontSize: '0.875rem', textAlign: 'center', padding: '2rem 0' }}>No pages yet.</p>
      )}
    </div>
  )
}

// ── Announcement Editor ──────────────────────────────────────────────────────

function AnnEditor({
  initial, onSave, onCancel,
}: {
  initial?: Partial<CmsAnnouncement>
  onSave: (d: { title: string; body: string; is_published: boolean; published_at: string; expires_at: string }) => Promise<void>
  onCancel: () => void
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [body, setBody] = useState(initial?.body ?? '')
  const [pub, setPub] = useState(initial?.is_published ?? false)
  const [pubAt, setPubAt] = useState(initial?.published_at ? initial.published_at.slice(0, 16) : '')
  const [expAt, setExpAt] = useState(initial?.expires_at ? initial.expires_at.slice(0, 16) : '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e: Event) {
    e.preventDefault()
    if (!title || !body) { setErr('Title and body are required'); return }
    setSaving(true); setErr('')
    try {
      await onSave({ title, body, is_published: pub, published_at: pubAt, expires_at: expAt })
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Error')
    } finally { setSaving(false) }
  }

  return (
    <form onSubmit={submit} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '1.25rem', marginBottom: '1rem' }}>
      <div style={{ marginBottom: '0.75rem' }}>
        <label style={LBL}>Title *</label>
        <input value={title} onInput={e => setTitle((e.target as HTMLInputElement).value)} style={INP} placeholder="Announcement title" />
      </div>
      <div style={{ marginBottom: '0.75rem' }}>
        <label style={LBL}>Body *</label>
        <textarea value={body} onInput={e => setBody((e.target as HTMLTextAreaElement).value)} style={{ ...INP, height: 100, resize: 'vertical' }} placeholder="Announcement content…" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <div>
          <label style={LBL}>Publish Date</label>
          <input type="datetime-local" value={pubAt} onInput={e => setPubAt((e.target as HTMLInputElement).value)} style={INP} />
        </div>
        <div>
          <label style={LBL}>Expires</label>
          <input type="datetime-local" value={expAt} onInput={e => setExpAt((e.target as HTMLInputElement).value)} style={INP} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <input type="checkbox" id="pub-ann" checked={pub} onChange={e => setPub((e.target as HTMLInputElement).checked)} />
        <label for="pub-ann" style={{ fontSize: '0.875rem', cursor: 'pointer' }}>Published</label>
      </div>
      {err && <p style={{ color: '#ef4444', fontSize: '0.8rem', marginBottom: '0.5rem' }}>{err}</p>}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button type="submit" disabled={saving} style={{ padding: '0.5rem 1.25rem', background: '#14463A', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem' }}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} style={{ padding: '0.5rem 1rem', background: 'none', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem', color: '#374151' }}>Cancel</button>
      </div>
    </form>
  )
}

// ── Announcements Tab ────────────────────────────────────────────────────────

function AnnouncementsTab() {
  const [anns, setAnns] = useState<CmsAnnouncement[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<CmsAnnouncement | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  async function load() {
    setLoading(true)
    try { setAnns(await cmsAdmin.listAnnouncements()) }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function handleCreate(d: Parameters<typeof cmsAdmin.createAnnouncement>[0]) {
    await cmsAdmin.createAnnouncement(d); setShowForm(false); load()
  }

  async function handleUpdate(id: string, d: Parameters<typeof cmsAdmin.updateAnnouncement>[1]) {
    await cmsAdmin.updateAnnouncement(id, d); setEditing(null); load()
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this announcement?')) return
    await cmsAdmin.deleteAnnouncement(id); setAnns(prev => prev.filter(a => a.id !== id))
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>{anns.length} announcement{anns.length !== 1 ? 's' : ''}</span>
        <button onClick={() => { setShowForm(s => !s); setEditing(null) }} style={{ padding: '0.4rem 1rem', background: '#14463A', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem' }}>
          {showForm ? 'Cancel' : '+ New Announcement'}
        </button>
      </div>
      {showForm && <AnnEditor onSave={handleCreate} onCancel={() => setShowForm(false)} />}
      {editing && <AnnEditor initial={editing} onSave={d => handleUpdate(editing.id, d)} onCancel={() => setEditing(null)} />}
      {err && <p style={{ color: '#ef4444', fontSize: '0.875rem' }}>{err}</p>}
      {loading && <p style={{ color: '#6b7280', fontSize: '0.875rem' }}>Loading…</p>}
      {anns.map(a => (
        <div key={a.id} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: '0.75rem 1rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#111827' }}>{a.title}</div>
            <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.body}</div>
            {a.expires_at && (
              <div style={{ fontSize: '0.7rem', color: '#f59e0b', marginTop: 2 }}>
                Expires {new Date(a.expires_at).toLocaleDateString()}
              </div>
            )}
          </div>
          <span style={{ padding: '2px 8px', borderRadius: 9999, fontSize: '0.7rem', fontWeight: 600, background: a.is_published ? '#d1fae5' : '#f3f4f6', color: a.is_published ? '#0D332A' : '#6b7280', flexShrink: 0 }}>
            {a.is_published ? 'LIVE' : 'DRAFT'}
          </span>
          <button onClick={() => { setEditing(a); setShowForm(false) }} style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: 4, padding: '0.25rem 0.625rem', cursor: 'pointer', fontSize: '0.75rem', color: '#374151', flexShrink: 0 }}>Edit</button>
          <button onClick={() => handleDelete(a.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: '1.1rem', flexShrink: 0 }}>×</button>
        </div>
      ))}
      {!loading && anns.length === 0 && !showForm && (
        <p style={{ color: '#9ca3af', fontSize: '0.875rem', textAlign: 'center', padding: '2rem 0' }}>No announcements yet.</p>
      )}
    </div>
  )
}

// ── Main View ────────────────────────────────────────────────────────────────

export function CmsAdminView() {
  const [tab, setTab] = useState<'pages' | 'announcements'>('pages')

  const TAB = (active: boolean): preact.JSX.CSSProperties => ({
    padding: '0.4rem 1rem',
    background: active ? '#14463A' : 'transparent',
    color: active ? '#fff' : '#374151',
    border: active ? 'none' : '1px solid #d1d5db',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: active ? 600 : 400,
  })

  return (
    <div style={{ maxWidth: 860, margin: '1.5rem auto', padding: '0 1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#111827' }}>Website CMS</h2>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={() => setTab('pages')} style={TAB(tab === 'pages')}>Pages</button>
          <button onClick={() => setTab('announcements')} style={TAB(tab === 'announcements')}>Announcements</button>
        </div>
      </div>
      {tab === 'pages' ? <PagesTab /> : <AnnouncementsTab />}
    </div>
  )
}
