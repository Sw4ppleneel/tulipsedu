-- Immutable event log. Rows are never updated or deleted.
-- Down: DROP TABLE audit_events CASCADE;

CREATE TABLE IF NOT EXISTS audit_events (
    id         BIGSERIAL PRIMARY KEY,
    tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    payload    JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX audit_events_tenant_created_idx ON audit_events (tenant_id, created_at);
CREATE INDEX audit_events_tenant_type_idx ON audit_events (tenant_id, event_type);
