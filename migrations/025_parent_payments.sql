-- 025_parent_payments.sql
-- Parent self-reported UPI payments + accountant verification.
-- A parent pays via the static UPI QR (no gateway callback exists for that), then
-- marks it paid here; it lands in 'pending_verification' until an accountant
-- approves it against the bank statement (using the optional UTR/reference).
--
-- Down:
--   ALTER TABLE fee_payments DROP COLUMN reference_no, DROP COLUMN verified_by,
--                            DROP COLUMN verified_at, DROP COLUMN rejection_reason;
--   ALTER TABLE fee_payments DROP CONSTRAINT fee_payments_gateway_check;
--   ALTER TABLE fee_payments ADD  CONSTRAINT fee_payments_gateway_check
--     CHECK (gateway IN ('razorpay','phonepe','mock'));
--   ALTER TABLE fee_payments DROP CONSTRAINT fee_payments_status_check;
--   ALTER TABLE fee_payments ADD  CONSTRAINT fee_payments_status_check
--     CHECK (status IN ('pending','processing','paid','failed','refunded'));

-- 'upi' = parent self-reported direct UPI transfer (no gateway).
ALTER TABLE fee_payments DROP CONSTRAINT IF EXISTS fee_payments_gateway_check;
ALTER TABLE fee_payments ADD  CONSTRAINT fee_payments_gateway_check
    CHECK (gateway IN ('razorpay', 'phonepe', 'mock', 'upi'));

-- 'pending_verification' = claimed by parent, awaiting accountant approval.
-- 'rejected' = accountant could not verify it (reason stored).
ALTER TABLE fee_payments DROP CONSTRAINT IF EXISTS fee_payments_status_check;
ALTER TABLE fee_payments ADD  CONSTRAINT fee_payments_status_check
    CHECK (status IN ('pending', 'processing', 'pending_verification', 'paid', 'failed', 'rejected', 'refunded'));

ALTER TABLE fee_payments
    ADD COLUMN IF NOT EXISTS reference_no     VARCHAR(40),   -- UPI UTR / reference, optional
    ADD COLUMN IF NOT EXISTS verified_by      UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS verified_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- The accountant verification queue reads (tenant, status); the existing
-- fee_payments_tenant_status_idx already covers it.
