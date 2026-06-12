-- Exam mark components: break a (term, subject) total into named parts that sum
-- to the total (CBSE style, e.g. Unit Test 10 + Oral 10 + Theory 80 = 100).
-- Component marks roll up into mark_entries.marks_obtained, so the existing
-- results/grade engine (which reads mark_entries + exam_marks_config) is unchanged.
-- Down:
--   DROP TABLE exam_component_marks CASCADE;
--   DROP TABLE exam_components CASCADE;

CREATE TABLE IF NOT EXISTS exam_components (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    exam_term_id    UUID NOT NULL REFERENCES exam_terms(id) ON DELETE CASCADE,
    exam_subject_id UUID NOT NULL REFERENCES exam_subjects(id) ON DELETE CASCADE,
    name            VARCHAR(50) NOT NULL,            -- 'Unit Test', 'Oral', 'Theory'
    max_marks       NUMERIC(6,2) NOT NULL CHECK (max_marks > 0),
    sort_order      SMALLINT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_exam_component UNIQUE (tenant_id, exam_term_id, exam_subject_id, name)
);

CREATE INDEX exam_components_term_subj_idx
    ON exam_components (tenant_id, exam_term_id, exam_subject_id, sort_order);

CREATE TABLE IF NOT EXISTS exam_component_marks (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id        UUID NOT NULL REFERENCES students(id),
    exam_component_id UUID NOT NULL REFERENCES exam_components(id) ON DELETE CASCADE,
    marks_obtained    NUMERIC(6,2) CHECK (marks_obtained >= 0),
    is_absent         BOOLEAN NOT NULL DEFAULT FALSE,
    entered_by        UUID REFERENCES users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_component_mark UNIQUE (tenant_id, student_id, exam_component_id)
);

CREATE INDEX exam_component_marks_comp_idx    ON exam_component_marks (tenant_id, exam_component_id);
CREATE INDEX exam_component_marks_student_idx ON exam_component_marks (tenant_id, student_id);
