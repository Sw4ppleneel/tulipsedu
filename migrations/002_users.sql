-- Staff and admin accounts. Phone number is the login identifier per tenant.
-- Down: DROP TABLE users CASCADE;

CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    phone_number  VARCHAR(15) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role          VARCHAR(50) NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tenant-first indexes per architecture rules
CREATE UNIQUE INDEX users_tenant_phone_idx ON users (tenant_id, phone_number);
CREATE INDEX users_tenant_created_idx ON users (tenant_id, created_at);
CREATE INDEX users_tenant_role_idx ON users (tenant_id, role);
