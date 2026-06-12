-- Classroom feed: homework, announcements, resources posted by teachers.
-- attachment_urls is a JSONB array of {name, url} objects (Cloudflare R2).
-- Down: DROP TABLE homework_posts CASCADE;

CREATE TABLE IF NOT EXISTS homework_posts (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    academic_year_id UUID NOT NULL REFERENCES academic_years(id),
    class_id         UUID NOT NULL REFERENCES classes(id),
    section_id       UUID NOT NULL REFERENCES sections(id),
    staff_id         UUID REFERENCES staff(id) ON DELETE SET NULL,
    subject          VARCHAR(100) NOT NULL,
    post_type        VARCHAR(20) NOT NULL DEFAULT 'homework'
                     CHECK (post_type IN ('homework', 'announcement', 'resource')),
    title            VARCHAR(255) NOT NULL,
    description      TEXT,
    due_date         DATE,
    attachment_urls  JSONB NOT NULL DEFAULT '[]',
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX homework_tenant_class_idx  ON homework_posts (tenant_id, class_id, section_id, created_at DESC);
CREATE INDEX homework_tenant_staff_idx  ON homework_posts (tenant_id, staff_id, created_at DESC);
CREATE INDEX homework_tenant_year_idx   ON homework_posts (tenant_id, academic_year_id, created_at DESC);
