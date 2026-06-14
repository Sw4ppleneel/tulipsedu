-- 029_year_rollover.sql
-- Adds status to academic_years so the system can mark a year as archived
-- after rollover, preventing accidental edits to completed years.
--
-- Status: 'active' = current or upcoming; 'archived' = rolled over and closed.
-- Only one year per tenant should be 'active' with is_current=TRUE at any time.
--
-- down:
--   ALTER TABLE academic_years DROP COLUMN status;

ALTER TABLE academic_years
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'archived'));

-- Set existing years as active (they're all 2025-2026 in current data).
UPDATE academic_years SET status = 'active' WHERE status IS DISTINCT FROM 'active';
