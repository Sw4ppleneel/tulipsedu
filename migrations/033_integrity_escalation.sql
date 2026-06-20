-- 033_integrity_escalation.sql
-- Adds throttle columns for two new scheduler jobs:
--   payment_claim_escalation() — escalates stale pending_verification claims
--   admissions_aging()         — nudges non-terminal admissions past 3 days
--
-- Both columns are nullable TIMESTAMPTZ (additive, reversible). No status values
-- changed. No destructive operation.
--
-- down:
--   ALTER TABLE fee_payments DROP COLUMN IF EXISTS escalated_at;
--   ALTER TABLE admissions   DROP COLUMN IF EXISTS nudged_at;

ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ NULL;
ALTER TABLE admissions   ADD COLUMN IF NOT EXISTS nudged_at    TIMESTAMPTZ NULL;
