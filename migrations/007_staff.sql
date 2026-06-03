-- Staff roster. employee_no is unique per tenant.
-- user_id links to a system login account (optional — non-teaching staff may not log in).
-- Partial unique index enforces one class teacher per section per year.
-- Down: DROP TABLE staff_class_assignments CASCADE; DROP TABLE staff CASCADE;

CREATE TABLE IF NOT EXISTS staff (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    employee_no     VARCHAR(50) NOT NULL,
    first_name      VARCHAR(100) NOT NULL,
    last_name       VARCHAR(100) NOT NULL,
    phone_number    VARCHAR(15) NOT NULL,
    designation     VARCHAR(100) NOT NULL,
    department      VARCHAR(100),
    date_of_joining DATE NOT NULL,
    date_of_birth   DATE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT unique_tenant_employee_no UNIQUE (tenant_id, employee_no)
);

CREATE INDEX staff_tenant_active_idx   ON staff (tenant_id, is_active);
CREATE INDEX staff_tenant_created_idx  ON staff (tenant_id, created_at);

CREATE TABLE IF NOT EXISTS staff_class_assignments (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    staff_id         UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    academic_year_id UUID NOT NULL REFERENCES academic_years(id),
    class_id         UUID NOT NULL REFERENCES classes(id),
    section_id       UUID NOT NULL REFERENCES sections(id),
    subject          VARCHAR(100),
    is_class_teacher BOOLEAN NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One class teacher per section per academic year
CREATE UNIQUE INDEX sca_one_class_teacher_idx
    ON staff_class_assignments (tenant_id, academic_year_id, class_id, section_id)
    WHERE is_class_teacher = TRUE;

-- One staff member teaches a subject to a section once per year
CREATE UNIQUE INDEX sca_staff_class_sec_subj_idx
    ON staff_class_assignments (tenant_id, academic_year_id, staff_id, class_id, section_id, subject)
    WHERE subject IS NOT NULL;

CREATE INDEX sca_tenant_staff_idx      ON staff_class_assignments (tenant_id, staff_id);
CREATE INDEX sca_tenant_class_sec_idx  ON staff_class_assignments (tenant_id, class_id, section_id);
