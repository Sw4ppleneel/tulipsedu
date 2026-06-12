BEGIN;

CREATE TABLE parents (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    phone_number   VARCHAR(15)  NOT NULL,
    name           VARCHAR(255),
    otp_hash       VARCHAR(255),
    otp_expires_at TIMESTAMPTZ,
    last_login_at  TIMESTAMPTZ,
    is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_parent_tenant_phone ON parents(tenant_id, phone_number);
CREATE INDEX idx_parents_tenant_active    ON parents(tenant_id, is_active);

-- Many-to-many: a parent can have multiple children; a student can have multiple parents
CREATE TABLE parent_students (
    parent_id    UUID        NOT NULL REFERENCES parents(id)  ON DELETE CASCADE,
    student_id   UUID        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    relationship VARCHAR(50) NOT NULL DEFAULT 'parent',
    PRIMARY KEY (parent_id, student_id)
);

CREATE INDEX idx_parent_students_student ON parent_students(student_id);

COMMIT;
