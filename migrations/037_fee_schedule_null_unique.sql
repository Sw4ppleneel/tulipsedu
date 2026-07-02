-- Fix fee_schedules uniqueness for NULL class_id (ALL-classes schedules).
-- PostgreSQL B-tree indexes treat NULL != NULL so the previous single unique
-- index on (tenant_id, fee_head_id, academic_year_id, class_id) never caught
-- duplicate rows when class_id was NULL. Replace it with two partial indexes.
--
-- Down:
--   DROP INDEX IF EXISTS unique_fee_schedule_all_classes;
--   DROP INDEX IF EXISTS unique_fee_schedule_per_class;
--   CREATE UNIQUE INDEX unique_fee_schedule
--     ON fee_schedules (tenant_id, fee_head_id, academic_year_id, class_id);

-- 1. Remove duplicates before adding the new constraints (keep oldest row).
DELETE FROM fee_schedules
WHERE id NOT IN (
    SELECT DISTINCT ON (tenant_id, fee_head_id, academic_year_id) id
    FROM fee_schedules
    WHERE class_id IS NULL
    ORDER BY tenant_id, fee_head_id, academic_year_id, created_at
)
AND class_id IS NULL;

-- 2. Drop old (broken) constraint/index (backed by a constraint — must use ALTER TABLE).
ALTER TABLE fee_schedules DROP CONSTRAINT IF EXISTS unique_fee_schedule;
DROP INDEX IF EXISTS unique_fee_schedule;

-- 3. Partial index for ALL-classes schedules (class_id IS NULL).
CREATE UNIQUE INDEX unique_fee_schedule_all_classes
    ON fee_schedules (tenant_id, fee_head_id, academic_year_id)
    WHERE class_id IS NULL;

-- 4. Regular index for class-specific schedules (class_id IS NOT NULL).
CREATE UNIQUE INDEX unique_fee_schedule_per_class
    ON fee_schedules (tenant_id, fee_head_id, academic_year_id, class_id)
    WHERE class_id IS NOT NULL;
