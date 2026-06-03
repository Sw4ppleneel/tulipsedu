-- Tenant registry. One row per institution.
-- Down: DROP TABLE tenants CASCADE;

CREATE TABLE IF NOT EXISTS tenants (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug             VARCHAR(63) NOT NULL,
    name             VARCHAR(255) NOT NULL,
    institution_type VARCHAR(50) NOT NULL DEFAULT 'school',
    feature_flags    JSONB NOT NULL DEFAULT '{}',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX tenants_slug_idx ON tenants (slug);
