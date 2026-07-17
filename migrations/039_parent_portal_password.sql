-- 039_parent_portal_password.sql
-- Parent-portal password, stored per student (parents log in with the child's
-- admission number; the JWT is scoped to that one student).
--
-- NULL hash = password never set. When the tenant flag
-- feature_flags.parent_password is on, login requires a password: the stored
-- hash if present, otherwise the last 4 digits of students.parent_phone
-- (rejected outright when the phone is the 0000000000 import placeholder).
-- The derived default is NOT persisted — it tracks the registered phone until
-- the parent (or staff) explicitly sets a password.
--
-- down: ALTER TABLE students DROP COLUMN portal_password_hash;

ALTER TABLE students ADD COLUMN IF NOT EXISTS portal_password_hash VARCHAR(255);
