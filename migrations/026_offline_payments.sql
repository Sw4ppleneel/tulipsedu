-- 026_offline_payments.sql
-- Office-recorded payments (cash/cheque/UPI-at-desk/bank transfer). Replaces the
-- mock-gateway + DEBUG-gated mock-complete shim that was being used for cash
-- collection. gateway='offline'; payment_method holds the specific method.
--
-- Down:
--   ALTER TABLE fee_payments DROP CONSTRAINT fee_payments_gateway_check;
--   ALTER TABLE fee_payments ADD  CONSTRAINT fee_payments_gateway_check
--     CHECK (gateway IN ('razorpay','phonepe','mock','upi'));

ALTER TABLE fee_payments DROP CONSTRAINT IF EXISTS fee_payments_gateway_check;
ALTER TABLE fee_payments ADD  CONSTRAINT fee_payments_gateway_check
    CHECK (gateway IN ('razorpay', 'phonepe', 'mock', 'upi', 'offline'));
