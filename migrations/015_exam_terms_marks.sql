-- Exam terms: Unit Test 1, Half Yearly, Annual, etc.
-- exam_marks_config: max marks and weightage per subject per term.
-- mark_entries: actual marks entered per student per subject per term.
--
-- Result formula: subject_pct = SUM(marks/max_marks * weightage) / SUM(weightage) * 100
-- Indian CBSE grades: A1(91+) A2(81) B1(71) B2(61) C1(51) C2(41) D(33) E(<33/fail)
-- Down: DROP TABLE mark_entries CASCADE; DROP TABLE exam_marks_config CASCADE; DROP TABLE exam_terms CASCADE;

CREATE TABLE IF NOT EXISTS exam_terms (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    academic_year_id UUID NOT NULL REFERENCES academic_years(id),
    name             VARCHAR(100) NOT NULL,
    term_type        VARCHAR(30) NOT NULL
                     CHECK (term_type IN ('unit_test','half_yearly','annual','practical','project','internal')),
    start_date       DATE,
    end_date         DATE,
    is_published     BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order       SMALLINT NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_exam_term UNIQUE (tenant_id, academic_year_id, name)
);

CREATE INDEX exam_terms_tenant_year_idx ON exam_terms (tenant_id, academic_year_id, sort_order);

-- Per-subject per-term marks configuration
CREATE TABLE IF NOT EXISTS exam_marks_config (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    exam_term_id     UUID NOT NULL REFERENCES exam_terms(id) ON DELETE CASCADE,
    exam_subject_id  UUID NOT NULL REFERENCES exam_subjects(id) ON DELETE CASCADE,
    max_marks        NUMERIC(6,2) NOT NULL CHECK (max_marks > 0),
    passing_marks    NUMERIC(6,2) NOT NULL DEFAULT 33,
    weightage        NUMERIC(5,2) NOT NULL DEFAULT 100.0 CHECK (weightage > 0),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_marks_config UNIQUE (tenant_id, exam_term_id, exam_subject_id)
);

CREATE INDEX exam_marks_config_term_idx ON exam_marks_config (tenant_id, exam_term_id);

-- Per-student mark entries — upsertable
CREATE TABLE IF NOT EXISTS mark_entries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id      UUID NOT NULL REFERENCES students(id),
    exam_term_id    UUID NOT NULL REFERENCES exam_terms(id),
    exam_subject_id UUID NOT NULL REFERENCES exam_subjects(id),
    marks_obtained  NUMERIC(6,2) CHECK (marks_obtained >= 0),
    is_absent       BOOLEAN NOT NULL DEFAULT FALSE,
    remarks         TEXT,
    entered_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_mark_entry UNIQUE (tenant_id, student_id, exam_term_id, exam_subject_id)
);

CREATE INDEX mark_entries_tenant_term_subj_idx ON mark_entries (tenant_id, exam_term_id, exam_subject_id);
CREATE INDEX mark_entries_tenant_student_idx   ON mark_entries (tenant_id, student_id);
