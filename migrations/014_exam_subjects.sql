-- Subjects offered per class per academic year.
-- Separate from class names so the same class can have different subjects each year.
-- Down: DROP TABLE exam_subjects CASCADE;

CREATE TABLE IF NOT EXISTS exam_subjects (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    academic_year_id UUID NOT NULL REFERENCES academic_years(id),
    class_id         UUID NOT NULL REFERENCES classes(id),
    name             VARCHAR(100) NOT NULL,
    subject_code     VARCHAR(20),
    sort_order       SMALLINT NOT NULL DEFAULT 0,
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_exam_subject UNIQUE (tenant_id, academic_year_id, class_id, name)
);

CREATE INDEX exam_subjects_tenant_class_idx ON exam_subjects (tenant_id, academic_year_id, class_id, sort_order);
