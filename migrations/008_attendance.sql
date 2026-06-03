-- Attendance sessions (one per class-section per day) and per-student records.
-- status: P = Present, A = Absent, L = Late
-- Down: DROP TABLE attendance_records CASCADE; DROP TABLE attendance_sessions CASCADE;

CREATE TABLE IF NOT EXISTS attendance_sessions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    academic_year_id UUID NOT NULL REFERENCES academic_years(id),
    class_id         UUID NOT NULL REFERENCES classes(id),
    section_id       UUID NOT NULL REFERENCES sections(id),
    date             DATE NOT NULL,
    marked_by        UUID NOT NULL REFERENCES users(id),
    submitted        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT unique_session_per_day
        UNIQUE (tenant_id, academic_year_id, class_id, section_id, date)
);

CREATE INDEX sessions_tenant_class_date_idx
    ON attendance_sessions (tenant_id, class_id, section_id, date DESC);

CREATE TABLE IF NOT EXISTS attendance_records (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    status     CHAR(1) NOT NULL DEFAULT 'P' CHECK (status IN ('P', 'A', 'L')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT unique_record_per_student_session
        UNIQUE (tenant_id, session_id, student_id)
);

-- Student-level report queries
CREATE INDEX records_tenant_student_idx ON attendance_records (tenant_id, student_id, created_at);
CREATE INDEX records_session_idx        ON attendance_records (session_id);
