-- 041_multiple_class_teachers.sql
-- Allow more than one class teacher per class/section (owner request — some
-- schools co-assign class-teacher duties). Drops the "exactly one" partial
-- unique index; replaces it with a plain (non-unique) index so lookups
-- filtered on is_class_teacher stay indexed.
--
-- down:
--   DROP INDEX IF EXISTS sca_class_teacher_idx;
--   CREATE UNIQUE INDEX sca_one_class_teacher_idx
--       ON staff_class_assignments (tenant_id, academic_year_id, class_id, section_id)
--       WHERE is_class_teacher = TRUE;

DROP INDEX IF EXISTS sca_one_class_teacher_idx;

CREATE INDEX IF NOT EXISTS sca_class_teacher_idx
    ON staff_class_assignments (tenant_id, academic_year_id, class_id, section_id)
    WHERE is_class_teacher = TRUE;
