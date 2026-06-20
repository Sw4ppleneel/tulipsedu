import { useState } from 'preact/hooks'
import { admissionsPublic } from '../../api/cms'
import { isValidIndianMobile, INVALID_PHONE_MSG } from '../../utils/phone'

// Theme is supplied by each school site so the form blends into its palette.
export interface AdmissionFormTheme {
  accent: string       // primary button / focus colour
  accentText: string   // text colour that reads on `accent`
  font: string
}

// Standard class labels — there is no public endpoint to list a tenant's class
// UUIDs, so the chosen label is folded into `notes` for staff to read.
const CLASS_OPTIONS = [
  'Nursery', 'LKG', 'UKG',
  'Class I', 'Class II', 'Class III', 'Class IV', 'Class V', 'Class VI',
  'Class VII', 'Class VIII', 'Class IX', 'Class X', 'Class XI', 'Class XII',
]

const FIELD_BORDER = '#D1D5DB'
const LABEL_COLOR = '#374151'

// A document a school asks applicants to upload (e.g. matric marksheet, TC).
export interface AdmissionDocSpec {
  label: string
  required?: boolean
}

const ACCEPTED_DOC_TYPES = ['application/pdf', 'image/jpeg', 'image/png']
const MAX_DOC_BYTES = 5 * 1024 * 1024

export function AdmissionForm(
  { theme, documents }: { theme: AdmissionFormTheme; documents?: AdmissionDocSpec[] },
) {
  // The form is collapsed by default and drops down when the visitor opts in,
  // so the section stays light until someone actually wants to apply.
  const [open, setOpen] = useState(false)

  const [applicantName, setApplicantName] = useState('')
  const [dob, setDob] = useState('')
  const [applyingClass, setApplyingClass] = useState('')
  const [parentName, setParentName] = useState('')
  const [parentPhone, setParentPhone] = useState('')
  const [message, setMessage] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Selected document files, keyed by their spec label.
  const [docFiles, setDocFiles] = useState<Record<string, File | null>>({})
  const hasDocs = !!(documents && documents.length)

  function setDocFile(label: string, file: File | null) {
    setDocFiles(prev => ({ ...prev, [label]: file }))
  }

  function reset() {
    setApplicantName(''); setDob(''); setApplyingClass('')
    setParentName(''); setParentPhone(''); setMessage('')
    setDocFiles({}); setProgress('')
    setError(''); setSuccess('')
  }

  async function handleSubmit(e: Event) {
    e.preventDefault()
    setError('')
    if (!applicantName.trim()) { setError("Please enter the applicant's name."); return }
    if (parentPhone.trim() && !isValidIndianMobile(parentPhone)) {
      setError(INVALID_PHONE_MSG); return
    }

    // Validate any attached / required documents before creating the enquiry.
    if (hasDocs) {
      for (const spec of documents!) {
        const f = docFiles[spec.label] || null
        if (!f) {
          if (spec.required) { setError(`Please attach the ${spec.label}.`); return }
          continue
        }
        if (!ACCEPTED_DOC_TYPES.includes(f.type)) {
          setError(`${spec.label}: only PDF, JPG, or PNG files are accepted.`); return
        }
        if (f.size > MAX_DOC_BYTES) {
          setError(`${spec.label}: file must be 5 MB or smaller.`); return
        }
      }
    }

    // Fold the selected class into notes (no public class-id lookup available).
    const notes = [
      applyingClass ? `Applying for: ${applyingClass}` : '',
      message.trim(),
    ].filter(Boolean).join('\n')

    setSubmitting(true)
    try {
      const res = await admissionsPublic.submitEnquiry({
        applicant_name: applicantName.trim(),
        applicant_dob: dob || undefined,
        parent_name: parentName.trim() || undefined,
        parent_phone: parentPhone.trim() || undefined,
        notes: notes || undefined,
      })

      // Upload documents (best-effort) — the enquiry is already saved at this point.
      const failed: string[] = []
      if (hasDocs && res.upload_token) {
        for (const spec of documents!) {
          const f = docFiles[spec.label] || null
          if (!f) continue
          setProgress(`Uploading ${spec.label}…`)
          try {
            await admissionsPublic.uploadDocument(res.upload_token, spec.label, f)
          } catch {
            failed.push(spec.label)
          }
        }
      }
      setProgress('')

      const base = res.message || 'Enquiry received. We will contact you shortly.'
      setSuccess(failed.length
        ? `${base}\n\nNote: we couldn't upload ${failed.join(', ')}. Our office will reach out to collect ${failed.length > 1 ? 'these' : 'it'}.`
        : base)
    } catch {
      setError('Something went wrong. Please try again, or call the school office.')
    } finally {
      setSubmitting(false)
    }
  }

  const inputStyle = {
    width: '100%',
    boxSizing: 'border-box' as const,
    padding: '.7rem .8rem',
    border: `1px solid ${FIELD_BORDER}`,
    borderRadius: 8,
    fontFamily: theme.font,
    fontSize: '.9rem',
    background: '#fff',
    color: '#111827',
  }
  const labelStyle = {
    display: 'block',
    fontFamily: theme.font,
    fontSize: '.74rem',
    fontWeight: 700,
    color: LABEL_COLOR,
    marginBottom: '.35rem',
    letterSpacing: '.02em',
  }

  const shell = {
    maxWidth: 640,
    margin: '0 auto',
  }
  const cardInner = {
    background: '#fff',
    borderRadius: 16,
    padding: '1.8rem',
    boxShadow: '0 10px 40px rgba(0,0,0,.18)',
  }

  // The toggle button that "drops" the form open. Stays as the only visible
  // element until clicked (or after a successful submit, when it hides the form).
  const toggleBtn = (
    <button
      type="button"
      onClick={() => setOpen(o => !o)}
      aria-expanded={open}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '.6rem',
        background: theme.accent,
        color: theme.accentText,
        border: 'none',
        borderRadius: 12,
        padding: '1rem 1.4rem',
        fontFamily: theme.font,
        fontWeight: 800,
        fontSize: '1rem',
        cursor: 'pointer',
        boxShadow: '0 8px 24px rgba(0,0,0,.16)',
      }}
    >
      Apply Online — Start Admission Enquiry
      <span style={{
        display: 'inline-block',
        transition: 'transform .3s ease',
        transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
        fontSize: '.8rem',
      }}>▾</span>
    </button>
  )

  // Success view replaces the collapsible body, but keeps the toggle hidden.
  if (success) {
    return (
      <div style={shell}>
        <div style={cardInner}>
          <div style={{ textAlign: 'center', fontFamily: theme.font }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%', background: theme.accent,
              color: theme.accentText, display: 'flex', alignItems: 'center',
              justifyContent: 'center', margin: '0 auto 1rem', fontSize: '1.8rem', fontWeight: 900,
            }}>✓</div>
            <h3 style={{ margin: '0 0 .5rem', color: '#111827', fontSize: '1.15rem' }}>Enquiry Submitted</h3>
            <p style={{ color: '#4B5563', fontSize: '.9rem', lineHeight: 1.6, margin: '0 0 1.3rem', whiteSpace: 'pre-line' }}>{success}</p>
            <button type="button" onClick={() => { reset(); setOpen(true) }} style={{
              background: 'transparent', border: `1px solid ${theme.accent}`, color: theme.accent,
              borderRadius: 8, padding: '.6rem 1.4rem', fontFamily: theme.font, fontWeight: 700,
              fontSize: '.85rem', cursor: 'pointer',
            }}>Submit another enquiry</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={shell}>
      {toggleBtn}

      {/* Collapsible body — drops down on toggle via a max-height transition
          (no animation library, per the lightweight-bundle rule). */}
      <div style={{
        overflow: 'hidden',
        maxHeight: open ? (hasDocs ? 2600 : 1600) : 0,
        opacity: open ? 1 : 0,
        transition: 'max-height .45s ease, opacity .3s ease, margin-top .45s ease',
        marginTop: open ? '1rem' : 0,
      }}>
        <form style={cardInner} onSubmit={handleSubmit}>
          <p style={{ margin: '0 0 1.4rem', color: '#6B7280', fontFamily: theme.font, fontSize: '.82rem', textAlign: 'center' }}>
            Fill in the details below and our admissions team will get in touch with you.
          </p>

          {error && (
            <div style={{
              background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C',
              borderRadius: 8, padding: '.7rem .9rem', fontFamily: theme.font,
              fontSize: '.82rem', marginBottom: '1rem',
            }}>{error}</div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '1rem' }}>
            <div>
              <label style={labelStyle}>Applicant's Name <span style={{ color: '#DC2626' }}>*</span></label>
              <input style={inputStyle} type="text" value={applicantName} required
                placeholder="Student's full name"
                onInput={e => setApplicantName((e.target as HTMLInputElement).value)} />
            </div>
            <div>
              <label style={labelStyle}>Date of Birth</label>
              <input style={inputStyle} type="date" value={dob}
                onInput={e => setDob((e.target as HTMLInputElement).value)} />
            </div>
            <div>
              <label style={labelStyle}>Applying for Class</label>
              <select style={inputStyle} value={applyingClass}
                onChange={e => setApplyingClass((e.target as HTMLSelectElement).value)}>
                <option value="">Select a class</option>
                {CLASS_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Parent / Guardian Name</label>
              <input style={inputStyle} type="text" value={parentName}
                placeholder="Parent or guardian"
                onInput={e => setParentName((e.target as HTMLInputElement).value)} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Phone Number</label>
              <input style={inputStyle} type="tel" value={parentPhone}
                placeholder="Contact number"
                onInput={e => setParentPhone((e.target as HTMLInputElement).value)} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Message (optional)</label>
              <textarea style={{ ...inputStyle, minHeight: 90, resize: 'vertical' }} value={message}
                placeholder="Anything you'd like to tell us"
                onInput={e => setMessage((e.target as HTMLTextAreaElement).value)} />
            </div>
          </div>

          {hasDocs && (
            <div style={{ marginTop: '1.4rem', borderTop: `1px solid ${FIELD_BORDER}`, paddingTop: '1.2rem' }}>
              <p style={{ margin: '0 0 .9rem', fontFamily: theme.font, fontSize: '.82rem', fontWeight: 800, color: '#111827' }}>
                Supporting Documents
              </p>
              <div style={{ display: 'grid', gap: '.9rem' }}>
                {documents!.map(spec => {
                  const f = docFiles[spec.label] || null
                  return (
                    <div key={spec.label}>
                      <label style={labelStyle}>
                        {spec.label}{spec.required && <span style={{ color: '#DC2626' }}> *</span>}
                      </label>
                      <input type="file"
                        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                        onChange={e => setDocFile(spec.label, (e.target as HTMLInputElement).files?.[0] || null)}
                        style={{ ...inputStyle, padding: '.5rem', fontSize: '.82rem' }} />
                      {f && (
                        <p style={{ margin: '.3rem 0 0', fontFamily: theme.font, fontSize: '.72rem', color: '#6B7280' }}>
                          {f.name} · {(f.size / 1024 / 1024).toFixed(1)} MB
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
              <p style={{ margin: '.7rem 0 0', fontFamily: theme.font, fontSize: '.7rem', color: '#9CA3AF' }}>
                PDF, JPG, or PNG · up to 5 MB each.
              </p>
            </div>
          )}

          <button type="submit" disabled={submitting} style={{
            width: '100%', marginTop: '1.4rem', background: theme.accent, color: theme.accentText,
            border: 'none', borderRadius: 8, padding: '.9rem', fontFamily: theme.font,
            fontWeight: 800, fontSize: '.95rem', cursor: submitting ? 'default' : 'pointer',
            opacity: submitting ? 0.7 : 1,
          }}>{submitting ? (progress || 'Sending…') : 'Submit Enquiry'}</button>

          <p style={{ margin: '.9rem 0 0', color: '#9CA3AF', fontFamily: theme.font, fontSize: '.72rem', textAlign: 'center' }}>
            Your details are sent securely to the school office.
          </p>
        </form>
      </div>
    </div>
  )
}
