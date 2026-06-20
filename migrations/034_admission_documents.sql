-- 034_admission_documents.sql
-- Attach uploaded supporting documents (e.g. Class 10 marksheet, TC, caste
-- certificate) to a public admission enquiry.
--
-- Documents are uploaded directly to Cloudflare R2 from the applicant's browser
-- using a short-lived, admission-scoped upload token (no staff login). Only the
-- metadata (label + public object URL + key) is stored here, never the binary.
-- Stored as a JSONB array of {name, url, key}. Gated per-tenant by the
-- feature_flags.admission_docs flag (only Premchand Mahto Inter College for now).
--
-- down:
--   ALTER TABLE admissions DROP COLUMN IF EXISTS documents;

ALTER TABLE admissions
  ADD COLUMN IF NOT EXISTS documents JSONB NOT NULL DEFAULT '[]'::jsonb;
