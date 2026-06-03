-- Fee ledger: one row per student per fee head per period.
-- period_month NULL = annual/one_time fee.
-- Two partial unique indexes handle both monthly (month NOT NULL) and annual (month IS NULL).
-- Down: DROP TABLE fee_ledger CASCADE;

CREATE TABLE IF NOT EXISTS fee_ledger (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id       UUID NOT NULL REFERENCES students(id),
    fee_head_id      UUID NOT NULL REFERENCES fee_heads(id),
    academic_year_id UUID NOT NULL REFERENCES academic_years(id),
    period_month     SMALLINT CHECK (period_month BETWEEN 1 AND 12),
    period_year      SMALLINT NOT NULL,
    amount_due       NUMERIC(10,2) NOT NULL,
    status           VARCHAR(20) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'paid', 'waived')),
    payment_id       UUID,               -- populated on payment (FK added in 011)
    waiver_reason    TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- NULL != NULL in SQL; two partial indexes enforce uniqueness for both cases
CREATE UNIQUE INDEX fee_ledger_unique_monthly
    ON fee_ledger (tenant_id, student_id, fee_head_id, period_year, period_month)
    WHERE period_month IS NOT NULL;

CREATE UNIQUE INDEX fee_ledger_unique_annual
    ON fee_ledger (tenant_id, student_id, fee_head_id, period_year)
    WHERE period_month IS NULL;

CREATE INDEX fee_ledger_tenant_student_idx ON fee_ledger (tenant_id, student_id, status);
CREATE INDEX fee_ledger_tenant_pending_idx ON fee_ledger (tenant_id, status, period_year, period_month);
