-- RBAC role vocabulary. Constrains users.role to the 6 staff roles.
-- The role column already exists (002_users.sql); this migration migrates
-- legacy 'admin' rows to 'principal' and locks the vocabulary with a CHECK.
-- Parents are NOT users rows (separate adm_no auth path), so 'parent' is
-- intentionally excluded from this constraint.
-- Down:
--   ALTER TABLE users DROP CONSTRAINT users_role_check;
--   UPDATE users SET role = 'admin' WHERE role = 'principal';

-- 1. Migrate legacy vocabulary: 'admin' was the school-head role.
UPDATE users SET role = 'principal' WHERE role = 'admin';

-- 2. Lock the role vocabulary. Any write outside this set is rejected.
ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN (
        'superadmin',
        'principal',
        'vice_principal',
        'class_teacher',
        'teacher',
        'accountant'
    ));
