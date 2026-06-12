-- Weekly timetable per class-section per academic year.
-- day_of_week: 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
-- period_number: 1-12 (schools typically have 6-8 periods per day)
-- Down: DROP TABLE timetable_slots CASCADE;

CREATE TABLE IF NOT EXISTS timetable_slots (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    academic_year_id UUID NOT NULL REFERENCES academic_years(id),
    class_id         UUID NOT NULL REFERENCES classes(id),
    section_id       UUID NOT NULL REFERENCES sections(id),
    day_of_week      SMALLINT NOT NULL CHECK (day_of_week BETWEEN 1 AND 6),
    period_number    SMALLINT NOT NULL CHECK (period_number BETWEEN 1 AND 12),
    start_time       TIME NOT NULL,
    end_time         TIME NOT NULL,
    subject          VARCHAR(100) NOT NULL,
    staff_id         UUID REFERENCES staff(id) ON DELETE SET NULL,
    room             VARCHAR(50),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_timetable_slot
        UNIQUE (tenant_id, academic_year_id, class_id, section_id, day_of_week, period_number)
);

CREATE INDEX timetable_tenant_class_idx ON timetable_slots (tenant_id, academic_year_id, class_id, section_id);
CREATE INDEX timetable_tenant_staff_idx ON timetable_slots (tenant_id, staff_id);
