-- 043_fee_schedule_monthly_reduction.sql
-- Lets a fee schedule carry a "this one calendar month = X% of the normal
-- amount" rule (owner request: DPS always charges 50% transport fee in
-- May). Applies automatically every year via ledger generation — no manual
-- per-year adjustment needed. Both columns nullable; either both set or
-- both NULL (a schedule with no seasonal reduction, the common case).
--
-- down:
--   ALTER TABLE fee_schedules DROP CONSTRAINT fee_schedules_reduction_pair_check;
--   ALTER TABLE fee_schedules DROP COLUMN reduced_month;
--   ALTER TABLE fee_schedules DROP COLUMN reduced_percentage;

ALTER TABLE fee_schedules ADD COLUMN IF NOT EXISTS reduced_month SMALLINT
    CHECK (reduced_month BETWEEN 1 AND 12);
ALTER TABLE fee_schedules ADD COLUMN IF NOT EXISTS reduced_percentage NUMERIC(5,2)
    CHECK (reduced_percentage > 0 AND reduced_percentage <= 100);

ALTER TABLE fee_schedules ADD CONSTRAINT fee_schedules_reduction_pair_check
    CHECK ((reduced_month IS NULL) = (reduced_percentage IS NULL));
