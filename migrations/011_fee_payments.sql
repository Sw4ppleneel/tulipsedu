-- Payment records are immutable once paid.
-- gateway_payment_id UNIQUE prevents double-webhook processing at the DB level.
-- fee_receipt_counters provides atomic per-tenant receipt numbering.
-- Down: DROP TABLE fee_payment_items CASCADE; DROP TABLE fee_payments CASCADE; DROP TABLE fee_receipt_counters;

CREATE TABLE IF NOT EXISTS fee_payments (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id         UUID NOT NULL REFERENCES students(id),
    payment_ref        VARCHAR(100) NOT NULL,         -- our idempotency key
    gateway            VARCHAR(20) NOT NULL CHECK (gateway IN ('razorpay', 'phonepe', 'mock')),
    gateway_order_id   VARCHAR(200),
    gateway_payment_id VARCHAR(200),
    amount             NUMERIC(10,2) NOT NULL,
    currency           CHAR(3) NOT NULL DEFAULT 'INR',
    status             VARCHAR(20) NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'processing', 'paid', 'failed', 'refunded')),
    payment_method     VARCHAR(30),
    receipt_number     VARCHAR(60),
    receipt_html       TEXT,
    paid_at            TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata           JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT unique_tenant_payment_ref   UNIQUE (tenant_id, payment_ref),
    CONSTRAINT unique_gateway_payment_id   UNIQUE (gateway_payment_id)
);

CREATE INDEX fee_payments_tenant_student_idx ON fee_payments (tenant_id, student_id);
CREATE INDEX fee_payments_tenant_status_idx  ON fee_payments (tenant_id, status, created_at DESC);
CREATE INDEX fee_payments_gateway_order_idx  ON fee_payments (gateway_order_id);

CREATE TABLE IF NOT EXISTS fee_payment_items (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    payment_id UUID NOT NULL REFERENCES fee_payments(id) ON DELETE CASCADE,
    ledger_id  UUID NOT NULL REFERENCES fee_ledger(id),
    amount     NUMERIC(10,2) NOT NULL,
    CONSTRAINT unique_payment_ledger UNIQUE (payment_id, ledger_id)
);

CREATE INDEX fee_payment_items_payment_idx ON fee_payment_items (payment_id);

-- Atomic per-tenant receipt counter: DEMO-2025-000042
CREATE TABLE IF NOT EXISTS fee_receipt_counters (
    tenant_id   UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    last_number INTEGER NOT NULL DEFAULT 0
);

-- Back-reference: fee_ledger.payment_id → fee_payments.id
ALTER TABLE fee_ledger
    ADD CONSTRAINT fee_ledger_payment_fk
    FOREIGN KEY (payment_id) REFERENCES fee_payments(id);
