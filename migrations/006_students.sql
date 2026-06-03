-- Student roster.
-- admission_no is unique per tenant; roll_number is unique per section per academic year.
-- ClassSwipe composite index covers the highest-frequency roster load query.
-- Down: DROP TABLE students CASCADE;

CREATE TABLE IF NOT EXISTS students (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    academic_year_id UUID NOT NULL REFERENCES academic_years(id),
    class_id         UUID NOT NULL REFERENCES classes(id),
    section_id       UUID NOT NULL REFERENCES sections(id),
    admission_no     VARCHAR(50) NOT NULL,
    roll_number      VARCHAR(50) NOT NULL,
    first_name       VARCHAR(100) NOT NULL,
    last_name        VARCHAR(100) NOT NULL,
    date_of_birth    DATE NOT NULL,
    gender           VARCHAR(20) NOT NULL,
    parent_phone     VARCHAR(10) NOT NULL,
    is_hosteler      BOOLEAN NOT NULL DEFAULT FALSE,
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT unique_tenant_admission_no  UNIQUE (tenant_id, admission_no),
    CONSTRAINT unique_tenant_section_roll  UNIQUE (tenant_id, academic_year_id, class_id, section_id, roll_number)
);

-- ClassSwipe primary lookup: roster card deck for a given class-section in a year
CREATE INDEX students_classswipe_idx    ON students (tenant_id, academic_year_id, class_id, section_id, is_active);
CREATE INDEX students_tenant_created_idx ON students (tenant_id, created_at);
