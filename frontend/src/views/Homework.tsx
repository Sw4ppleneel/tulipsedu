import { useEffect, useState } from 'preact/hooks'
import { listHomework, createHomework, deleteHomework } from '../api/homework'
import { listAcademicYears, listClasses } from '../api/students'
import type { HomeworkPost, HomeworkCreate } from '../api/homework'
import type { AcademicYear, Class, Section } from '../types/student'

const PILL: Record<string, { bg: string; color: string }> = {
  homework:     { bg: '#E7EFEA', color: '#0D332A' },
  announcement: { bg: '#fef3c7', color: '#92400e' },
  resource:     { bg: '#d1fae5', color: '#0D332A' },
}

function PostCard({ post, onDelete }: { post: HomeworkPost; onDelete: () => void }) {
  const pill = PILL[post.post_type] ?? PILL.homework
  return (
    <div style={{ background: '#fff', borderRadius: 6, border: '1px solid #e5e7eb', padding: '0.875rem 1rem', marginBottom: '0.625rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
            <span style={{ ...pill, padding: '1px 8px', borderRadius: 9999, fontSize: '0.7rem', fontWeight: 600 }}>
              {post.post_type.toUpperCase()}
            </span>
            <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>{post.subject}</span>
            {post.due_date && (
              <span style={{ fontSize: '0.75rem', color: '#ef4444' }}>Due {post.due_date}</span>
            )}
          </div>
          <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#111827', marginBottom: '0.2rem' }}>{post.title}</div>
          {post.description && <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>{post.description}</div>}
          <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.4rem' }}>
            {post.class_name} {post.section_name}{post.staff_name ? ` · ${post.staff_name}` : ''} · {new Date(post.created_at).toLocaleDateString()}
          </div>
        </div>
        <button
          onClick={onDelete}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: '1.1rem', padding: '0 0.25rem', flexShrink: 0 }}
          title="Delete"
        >×</button>
      </div>
    </div>
  )
}

function PostForm({
  years, classes, onSubmit, onCancel,
}: {
  years: AcademicYear[]
  classes: Class[]
  onSubmit: (d: HomeworkCreate) => Promise<void>
  onCancel: () => void
}) {
  const [ay, setAy] = useState(years[0]?.id ?? '')
  const [cls, setCls] = useState('')
  const [sec, setSec] = useState('')
  const [subject, setSubject] = useState('')
  const [type, setType] = useState<HomeworkCreate['post_type']>('homework')
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [due, setDue] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const sections: Section[] = classes.find(c => c.id === cls)?.sections ?? []

  async function submit(e: Event) {
    e.preventDefault()
    if (!cls || !sec || !subject || !title) { setErr('All required fields must be filled'); return }
    setSaving(true); setErr('')
    try {
      await onSubmit({ academic_year_id: ay, class_id: cls, section_id: sec, subject, post_type: type, title, description: desc || undefined, due_date: due || undefined })
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Error')
    } finally { setSaving(false) }
  }

  const INP: preact.JSX.CSSProperties = { width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.875rem', boxSizing: 'border-box' }
  const LBL: preact.JSX.CSSProperties = { display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#374151', marginBottom: '0.25rem' }

  return (
    <form onSubmit={submit} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '1.25rem', marginBottom: '1rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <div>
          <label style={LBL}>Academic Year</label>
          <select value={ay} onChange={e => setAy((e.target as HTMLSelectElement).value)} style={INP}>
            {years.map(y => <option key={y.id} value={y.id}>{y.name}</option>)}
          </select>
        </div>
        <div>
          <label style={LBL}>Class *</label>
          <select value={cls} onChange={e => { setCls((e.target as HTMLSelectElement).value); setSec('') }} style={INP}>
            <option value="">— select —</option>
            {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label style={LBL}>Section *</label>
          <select value={sec} onChange={e => setSec((e.target as HTMLSelectElement).value)} style={INP} disabled={!cls}>
            <option value="">— select —</option>
            {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label style={LBL}>Type</label>
          <select value={type} onChange={e => setType((e.target as HTMLSelectElement).value as HomeworkCreate['post_type'])} style={INP}>
            <option value="homework">Homework</option>
            <option value="announcement">Announcement</option>
            <option value="resource">Resource</option>
          </select>
        </div>
        <div>
          <label style={LBL}>Subject *</label>
          <input value={subject} onInput={e => setSubject((e.target as HTMLInputElement).value)} style={INP} placeholder="e.g. Mathematics" />
        </div>
        <div>
          <label style={LBL}>Due Date</label>
          <input type="date" value={due} onInput={e => setDue((e.target as HTMLInputElement).value)} style={INP} />
        </div>
      </div>
      <div style={{ marginBottom: '0.75rem' }}>
        <label style={LBL}>Title *</label>
        <input value={title} onInput={e => setTitle((e.target as HTMLInputElement).value)} style={INP} placeholder="Post title" />
      </div>
      <div style={{ marginBottom: '0.75rem' }}>
        <label style={LBL}>Description</label>
        <textarea value={desc} onInput={e => setDesc((e.target as HTMLTextAreaElement).value)} style={{ ...INP, height: 72, resize: 'vertical' }} placeholder="Optional details…" />
      </div>
      {err && <p style={{ color: '#ef4444', fontSize: '0.8rem', marginBottom: '0.5rem' }}>{err}</p>}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button type="submit" disabled={saving} style={{ padding: '0.5rem 1.25rem', background: '#14463A', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem' }}>
          {saving ? 'Posting…' : 'Post'}
        </button>
        <button type="button" onClick={onCancel} style={{ padding: '0.5rem 1rem', background: 'none', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem', color: '#374151' }}>
          Cancel
        </button>
      </div>
    </form>
  )
}

export function HomeworkView() {
  const [posts, setPosts] = useState<HomeworkPost[]>([])
  const [years, setYears] = useState<AcademicYear[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [filterType, setFilterType] = useState('')
  const [filterClass, setFilterClass] = useState('')
  const [err, setErr] = useState('')

  async function load(classId?: string, type?: string) {
    setLoading(true); setErr('')
    try {
      const data = await listHomework({ class_id: classId || undefined, post_type: type || undefined, limit: 100 })
      setPosts(data)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load')
    } finally { setLoading(false) }
  }

  useEffect(() => {
    Promise.all([listAcademicYears(), listClasses()]).then(([ay, cls]) => {
      setYears(ay)
      setClasses(cls)
    })
    load()
  }, [])

  function applyFilters(cls?: string, type?: string) {
    const c = cls ?? filterClass
    const t = type ?? filterType
    load(c, t)
  }

  async function handleCreate(data: HomeworkCreate) {
    await createHomework(data)
    setShowForm(false)
    load(filterClass, filterType)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this post?')) return
    await deleteHomework(id)
    setPosts(prev => prev.filter(p => p.id !== id))
  }

  const filtered = posts

  return (
    <div style={{ maxWidth: 800, margin: '1.5rem auto', padding: '0 1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#111827' }}>Homework & Feed</h2>
        <button
          onClick={() => setShowForm(s => !s)}
          style={{ padding: '0.4rem 1rem', background: '#14463A', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem' }}
        >
          {showForm ? 'Cancel' : '+ New Post'}
        </button>
      </div>

      {showForm && (
        <PostForm years={years} classes={classes} onSubmit={handleCreate} onCancel={() => setShowForm(false)} />
      )}

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <select
          value={filterClass}
          onChange={e => { const v = (e.target as HTMLSelectElement).value; setFilterClass(v); applyFilters(v, filterType) }}
          style={{ padding: '0.375rem 0.625rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.8rem' }}
        >
          <option value="">All classes</option>
          {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select
          value={filterType}
          onChange={e => { const v = (e.target as HTMLSelectElement).value; setFilterType(v); applyFilters(filterClass, v) }}
          style={{ padding: '0.375rem 0.625rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.8rem' }}
        >
          <option value="">All types</option>
          <option value="homework">Homework</option>
          <option value="announcement">Announcement</option>
          <option value="resource">Resource</option>
        </select>
        <span style={{ fontSize: '0.8rem', color: '#6b7280', alignSelf: 'center' }}>{filtered.length} post{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {err && <p style={{ color: '#ef4444', fontSize: '0.875rem', marginBottom: '0.75rem' }}>{err}</p>}
      {loading && <p style={{ color: '#6b7280', fontSize: '0.875rem' }}>Loading…</p>}
      {!loading && filtered.length === 0 && (
        <p style={{ color: '#9ca3af', fontSize: '0.875rem', textAlign: 'center', padding: '2rem 0' }}>No posts yet. Use "New Post" to create one.</p>
      )}
      {filtered.map(p => <PostCard key={p.id} post={p} onDelete={() => handleDelete(p.id)} />)}
    </div>
  )
}
