-- Academic year registry per tenant.
-- Partial unique index enforces at most one current year per tenant.
-- Down: DROP TABLE academic_years CASCADE;

CREATE TABLE IF NOT EXISTS academic_years (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name       VARCHAR(20) NOT NULL,
    start_date DATE NOT NULL,
    end_date   DATE NOT NULL,
    is_current BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX academic_years_tenant_name_idx ON academic_years (tenant_id, name);
CREATE INDEX         academic_years_tenant_idx      ON academic_years (tenant_id, created_at);
CREATE UNIQUE INDEX  academic_years_one_current_idx ON academic_years (tenant_id) WHERE is_current = TRUE;
