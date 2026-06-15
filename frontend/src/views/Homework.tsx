import { useEffect, useRef, useState } from 'preact/hooks'
import { listHomework, createHomework, deleteHomework } from '../api/homework'
import { listAcademicYears, listClasses } from '../api/students'
import { uploadFiles, UploadError } from '../api/uploads'
import type { Attachment } from '../api/uploads'
import type { HomeworkPost, HomeworkCreate } from '../api/homework'
import type { AcademicYear, Class, Section } from '../types/student'

const PILL: Record<string, { bg: string; color: string }> = {
  homework:     { bg: '#E7EFEA', color: '#0D332A' },
  announcement: { bg: '#fef3c7', color: '#92400e' },
  resource:     { bg: '#d1fae5', color: '#0D332A' },
}

function fileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return '🖼'
  if (ext === 'pdf') return '📄'
  if (['doc', 'docx'].includes(ext)) return '📝'
  if (['ppt', 'pptx'].includes(ext)) return '📊'
  if (['xls', 'xlsx'].includes(ext)) return '📋'
  return '📎'
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
          {post.attachment_urls.length > 0 && (
            <div style={{ marginTop: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
              {post.attachment_urls.map((a, i) => (
                <a key={i} href={a.url} target="_blank" rel="noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.72rem', color: '#14463A', background: '#E7EFEA', borderRadius: 4, padding: '2px 7px', textDecoration: 'none', fontWeight: 500 }}>
                  <span>{fileIcon(a.name)}</span>{a.name}
                </a>
              ))}
            </div>
          )}
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
  years, classes, onSubmit, onCancel, lockedType,
}: {
  years: AcademicYear[]
  classes: Class[]
  onSubmit: (d: HomeworkCreate) => Promise<void>
  onCancel: () => void
  lockedType?: HomeworkCreate['post_type']
}) {
  const [ay, setAy] = useState(years[0]?.id ?? '')
  const [cls, setCls] = useState('')
  const [sec, setSec] = useState('')
  const [subject, setSubject] = useState('')
  const [type, setType] = useState<HomeworkCreate['post_type']>(lockedType ?? 'homework')
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [due, setDue] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const sections: Section[] = classes.find(c => c.id === cls)?.sections ?? []

  async function handleFiles(e: Event) {
    const files = Array.from((e.target as HTMLInputElement).files ?? [])
    if (!files.length) return
    setUploading(true); setErr('')
    try {
      const uploaded = await uploadFiles(files)
      setAttachments(prev => [...prev, ...uploaded].slice(0, 5))
    } catch (ex) {
      setErr(ex instanceof UploadError ? ex.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function removeAttachment(i: number) {
    setAttachments(prev => prev.filter((_, idx) => idx !== i))
  }

  async function submit(e: Event) {
    e.preventDefault()
    if (!cls || !sec || !subject || !title) { setErr('All required fields must be filled'); return }
    setSaving(true); setErr('')
    try {
      await onSubmit({ academic_year_id: ay, class_id: cls, section_id: sec, subject, post_type: type, title, description: desc || undefined, due_date: due || undefined, attachment_urls: attachments.length ? attachments : undefined })
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
        {!lockedType && (
          <div>
            <label style={LBL}>Type</label>
            <select value={type} onChange={e => setType((e.target as HTMLSelectElement).value as HomeworkCreate['post_type'])} style={INP}>
              <option value="homework">Homework</option>
              <option value="announcement">Announcement</option>
              <option value="resource">Resource</option>
            </select>
          </div>
        )}
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
      {/* File attachments */}
      <div style={{ marginBottom: '0.75rem' }}>
        <label style={LBL}>Attachments <span style={{ color: '#9ca3af', fontWeight: 400 }}>(images, PDF, Office — max 10 MB each, up to 5)</span></label>
        {attachments.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.4rem' }}>
            {attachments.map((a, i) => (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.72rem', background: '#E7EFEA', color: '#14463A', borderRadius: 4, padding: '2px 6px' }}>
                {a.name}
                <button type="button" onClick={() => removeAttachment(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: 0, lineHeight: 1 }}>×</button>
              </span>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input ref={fileRef} type="file" multiple accept="image/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx"
            onChange={handleFiles} style={{ display: 'none' }} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading || attachments.length >= 5}
            style={{ padding: '0.35rem 0.9rem', border: '1px solid #d1d5db', borderRadius: 4, background: '#f9fafb', cursor: 'pointer', fontSize: '0.8rem', color: '#374151' }}>
            {uploading ? 'Uploading…' : '+ Attach files'}
          </button>
          {attachments.length >= 5 && <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>Max 5 files</span>}
        </div>
      </div>
      {err && <p style={{ color: '#ef4444', fontSize: '0.8rem', marginBottom: '0.5rem' }}>{err}</p>}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button type="submit" disabled={saving || uploading} style={{ padding: '0.5rem 1.25rem', background: '#14463A', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem' }}>
          {saving ? 'Posting…' : 'Post'}
        </button>
        <button type="button" onClick={onCancel} style={{ padding: '0.5rem 1rem', background: 'none', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem', color: '#374151' }}>
          Cancel
        </button>
      </div>
    </form>
  )
}

// Each post_type is its own section now (Homework / Announcements / Study Material),
// so they're no longer clubbed under one "Feed". defaultType locks the section.
const TYPE_META: Record<string, { title: string; noun: string }> = {
  homework:     { title: 'Homework',       noun: 'homework' },
  announcement: { title: 'Announcements',  noun: 'announcement' },
  resource:     { title: 'Study Material', noun: 'material' },
}

export function HomeworkView({ defaultType }: { defaultType?: 'homework' | 'announcement' | 'resource' } = {}) {
  const [posts, setPosts] = useState<HomeworkPost[]>([])
  const [years, setYears] = useState<AcademicYear[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [filterType, setFilterType] = useState(defaultType ?? '')
  const [filterClass, setFilterClass] = useState('')
  const [err, setErr] = useState('')

  const meta = defaultType ? TYPE_META[defaultType] : null

  async function load(classId?: string, type?: string) {
    setLoading(true); setErr('')
    try {
      const data = await listHomework({ class_id: classId || undefined, post_type: (type ?? defaultType) || undefined, limit: 100 })
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
    load(undefined, defaultType)
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
        <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#111827' }}>{meta?.title ?? 'Homework & Feed'}</h2>
        <button
          onClick={() => setShowForm(s => !s)}
          style={{ padding: '0.4rem 1rem', background: '#14463A', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.875rem' }}
        >
          {showForm ? 'Cancel' : `+ New ${meta ? meta.title.replace(/s$/, '') : 'Post'}`}
        </button>
      </div>

      {showForm && (
        <PostForm years={years} classes={classes} onSubmit={handleCreate} onCancel={() => setShowForm(false)} lockedType={defaultType} />
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
        {!defaultType && (
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
        )}
        <span style={{ fontSize: '0.8rem', color: '#6b7280', alignSelf: 'center' }}>{filtered.length} {meta?.noun ?? 'post'}{filtered.length !== 1 ? 's' : ''}</span>
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
