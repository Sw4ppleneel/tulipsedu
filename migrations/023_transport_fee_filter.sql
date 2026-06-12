-- is_transport flag on students; student_filter on fee_schedules.
-- student_filter controls which students a fee schedule applies to:
--   'all'       — every student (default)
--   'transport' — only students with is_transport = TRUE
--   'hosteler'  — only students with is_hosteler = TRUE
-- Down: ALTER TABLE fee_schedules DROP COLUMN student_filter;
--       ALTER TABLE students DROP COLUMN is_transport;

ALTER TABLE students
    ADD COLUMN IF NOT EXISTS is_transport BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE fee_schedules
    ADD COLUMN IF NOT EXISTS student_filter VARCHAR(20) NOT NULL DEFAULT 'all'
        CHECK (student_filter IN ('all', 'transport', 'hosteler'));
