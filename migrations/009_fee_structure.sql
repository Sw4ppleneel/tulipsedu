-- Fee heads define categories (Tuition, Transport, Annual, etc.)
-- Fee schedules define amounts per class per academic year.
-- Down: DROP TABLE fee_schedules CASCADE; DROP TABLE fee_heads CASCADE;

CREATE TABLE IF NOT EXISTS fee_heads (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name        VARCHAR(100) NOT NULL,
    fee_type    VARCHAR(20) NOT NULL CHECK (fee_type IN ('monthly', 'annual', 'one_time')),
    sort_order  SMALLINT NOT NULL DEFAULT 0,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_tenant_fee_head UNIQUE (tenant_id, name)
);

CREATE INDEX fee_heads_tenant_idx ON fee_heads (tenant_id, is_active);

CREATE TABLE IF NOT EXISTS fee_schedules (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    fee_head_id      UUID NOT NULL REFERENCES fee_heads(id) ON DELETE CASCADE,
    academic_year_id UUID NOT NULL REFERENCES academic_years(id),
    class_id         UUID REFERENCES classes(id) ON DELETE CASCADE,  -- NULL = all classes
    amount           NUMERIC(10,2) NOT NULL CHECK (amount > 0),
    due_day_of_month SMALLINT NOT NULL DEFAULT 10 CHECK (due_day_of_month BETWEEN 1 AND 28),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_fee_schedule UNIQUE (tenant_id, fee_head_id, academic_year_id, class_id)
);

CREATE INDEX fee_schedules_tenant_year_idx ON fee_schedules (tenant_id, academic_year_id);
