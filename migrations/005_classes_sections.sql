-- Class and section registry.
-- Classes are generic: Grade 1-12, LKG/UKG, Semester 1-6, etc.
-- Down: DROP TABLE sections CASCADE; DROP TABLE classes CASCADE;

CREATE TABLE IF NOT EXISTS classes (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name          VARCHAR(100) NOT NULL,
    numeric_order SMALLINT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX classes_tenant_name_idx  ON classes (tenant_id, name);
CREATE INDEX        classes_tenant_order_idx ON classes (tenant_id, numeric_order);

CREATE TABLE IF NOT EXISTS sections (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    class_id   UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    name       VARCHAR(10) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX sections_tenant_class_name_idx ON sections (tenant_id, class_id, name);
CREATE INDEX        sections_tenant_class_idx       ON sections (tenant_id, class_id);
