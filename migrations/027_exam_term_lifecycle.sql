-- 027_exam_term_lifecycle.sql
-- Adds a 4-state lifecycle to exam_terms:
--   draft → marks_open → locked → published
-- is_published is kept in sync on every transition (backward compat with
-- results queries that filter is_published = TRUE).
--
-- Down:
--   ALTER TABLE exam_terms DROP COLUMN status;

ALTER TABLE exam_terms
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'draft'
  CHECK (status IN ('draft', 'marks_open', 'locked', 'published'));

-- Sync existing published terms; everything else stays draft.
UPDATE exam_terms SET status = 'published' WHERE is_published = TRUE;
