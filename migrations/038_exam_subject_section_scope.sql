-- Add optional section_id to exam_subjects for stream-specific curriculum scoping.
-- NULL means the subject applies to all sections of the class (current behavior,
-- unchanged for all existing tenants). Setting section_id restricts the subject
-- to that stream only (e.g. Physics only for Science stream at PMIC).
--
-- Uses the same partial-unique-index pattern as migration 037 (fee_schedules),
-- because PostgreSQL B-tree treats NULL != NULL in unique constraints.
--
-- Down:
--   DROP INDEX IF EXISTS unique_exam_subject_per_section;
--   DROP INDEX IF EXISTS unique_exam_subject_all_sections;
--   ALTER TABLE exam_subjects DROP COLUMN IF EXISTS section_id;
--   CREATE UNIQUE INDEX unique_exam_subject ON exam_subjects (tenant_id, academic_year_id, class_id, name);

ALTER TABLE exam_subjects ADD COLUMN section_id UUID REFERENCES sections(id) ON DELETE CASCADE;

ALTER TABLE exam_subjects DROP CONSTRAINT IF EXISTS unique_exam_subject;
DROP INDEX IF EXISTS unique_exam_subject;

-- For subjects scoped to all sections (section_id IS NULL)
CREATE UNIQUE INDEX unique_exam_subject_all_sections
    ON exam_subjects (tenant_id, academic_year_id, class_id, name)
    WHERE section_id IS NULL;

-- For subjects scoped to a specific section
CREATE UNIQUE INDEX unique_exam_subject_per_section
    ON exam_subjects (tenant_id, academic_year_id, class_id, section_id, name)
    WHERE section_id IS NOT NULL;
