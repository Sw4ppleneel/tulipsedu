import { getAuthState } from './auth_state'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
const MAX_FILES = 5

const ALLOWED_TYPES: Record<string, boolean> = {
  'image/jpeg': true, 'image/png': true, 'image/webp': true, 'image/gif': true,
  'application/pdf': true,
  'application/msword': true,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': true,
  'application/vnd.ms-powerpoint': true,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': true,
  'application/vnd.ms-excel': true,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': true,
}

export interface Attachment {
  name: string
  url: string
}

export class UploadError extends Error {}

function validate(file: File) {
  if (!ALLOWED_TYPES[file.type]) {
    throw new UploadError(`"${file.name}" — unsupported type. Upload images, PDF, or Office documents only.`)
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new UploadError(`"${file.name}" exceeds the 10 MB limit.`)
  }
}

async function uploadOne(file: File): Promise<Attachment> {
  validate(file)

  const auth = getAuthState()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (auth) {
    headers['Authorization'] = `Bearer ${auth.accessToken}`
    headers['X-Tenant-Slug'] = auth.tenantSlug
  }

  // Step 1: get presigned URL from backend
  const res = await fetch('/api/v1/uploads/url', {
    method: 'POST',
    headers,
    body: JSON.stringify({ filename: file.name, content_type: file.type }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new UploadError(body.detail || `Upload failed (${res.status})`)
  }
  const { upload_url, object_key, public_url, content_type } = await res.json() as {
    upload_url: string; object_key: string; public_url: string; content_type: string
  }

  // Step 2: PUT the raw file straight to R2 (no auth header — the signed URL is the
  // auth; Content-Type must match what was signed or R2 rejects the signature).
  // R2 doesn't support presigned POST, so the size limit can't be enforced as a
  // condition on this request — step 3 closes that gap server-side.
  const put = await fetch(upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': content_type },
    body: file,
  })
  if (!put.ok) throw new UploadError(`Upload to storage failed (${put.status})`)

  // Step 3: confirm with the backend — verifies the uploaded object's real size and
  // deletes it if it's over the limit (a malicious client could lie about file.size).
  const confirm = await fetch('/api/v1/uploads/confirm', {
    method: 'POST',
    headers,
    body: JSON.stringify({ object_key }),
  })
  if (!confirm.ok) {
    const body = await confirm.json().catch(() => ({}))
    throw new UploadError(body.detail || `Upload rejected (${confirm.status})`)
  }

  return { name: file.name, url: public_url }
}

export async function uploadFiles(files: File[]): Promise<Attachment[]> {
  if (files.length > MAX_FILES) {
    throw new UploadError(`You can attach at most ${MAX_FILES} files per post.`)
  }
  return Promise.all(files.map(uploadOne))
}
