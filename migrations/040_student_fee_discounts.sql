-- 040_student_fee_discounts.sql
-- Per-student percentage concessions (sibling discounts etc.), keyed by fee head.
--
-- Setting/clearing discounts recomputes the student's unpaid
-- (pending/due/overdue) ledger rows from the fee-schedule base amount, so the
-- operation is idempotent (10% -> 20% never compounds). Paid/waived rows are
-- never touched; ledger rows with no matching schedule (e.g. arrears carried
-- forward by year rollover) are left as-is. Ledger generation applies the
-- percentage at insert time for future rows.
--
-- down: DROP TABLE student_fee_discounts;

CREATE TABLE IF NOT EXISTS student_fee_discounts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id  UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    fee_head_id UUID NOT NULL REFERENCES fee_heads(id) ON DELETE CASCADE,
    percentage  NUMERIC(5,2) NOT NULL CHECK (percentage > 0 AND percentage <= 100),
    reason      VARCHAR(100) NOT NULL DEFAULT 'sibling',
    created_by  UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_student_fee_discount UNIQUE (tenant_id, student_id, fee_head_id)
);

CREATE INDEX IF NOT EXISTS student_fee_discounts_student_idx
    ON student_fee_discounts (tenant_id, student_id);
