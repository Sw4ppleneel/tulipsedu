-- 028_fee_lifecycle.sql
-- Adds 'due' + 'overdue' to fee_ledger.status and an explicit due_date column
-- used by the scheduler to advance lifecycle state.
--
-- Status lifecycle: pending → due → overdue → paid (or waived at any point)
-- 'due'     = within the grace period (ledger entry is approaching or just past due_date)
-- 'overdue' = past the grace period, FEE_OVERDUE reminder emitted
--
-- down:
--   ALTER TABLE fee_ledger DROP COLUMN due_date;
--   ALTER TABLE fee_ledger DROP CONSTRAINT fee_ledger_status_check;
--   ALTER TABLE fee_ledger ADD  CONSTRAINT fee_ledger_status_check
--     CHECK (status IN ('pending', 'paid', 'waived'));

ALTER TABLE fee_ledger DROP CONSTRAINT IF EXISTS fee_ledger_status_check;
ALTER TABLE fee_ledger ADD CONSTRAINT fee_ledger_status_check
  CHECK (status IN ('pending', 'due', 'overdue', 'paid', 'waived'));

-- Explicit due_date for the scheduler. Standard school convention: 5th of the month.
-- Annual/one_time entries get period_month=NULL; use June-30 of period_year as default.
ALTER TABLE fee_ledger ADD COLUMN IF NOT EXISTS due_date DATE;

-- Backfill from period_year/period_month.
UPDATE fee_ledger
  SET due_date = MAKE_DATE(period_year::int, period_month::int, 5)
  WHERE period_month IS NOT NULL AND due_date IS NULL;

UPDATE fee_ledger
  SET due_date = MAKE_DATE(period_year::int, 6, 30)
  WHERE period_month IS NULL AND due_date IS NULL;

CREATE INDEX IF NOT EXISTS fee_ledger_due_date_idx
  ON fee_ledger (tenant_id, status, due_date)
  WHERE status IN ('pending', 'due');
