-- 042_user_roles.sql
-- Multi-role support for staff. A user can hold more than one of the 5
-- assignable staff roles simultaneously (e.g. accountant + teacher — a real
-- combo the owner needs). users.role stays NOT NULL and is now a FROZEN
-- legacy snapshot (set to roles[0] on any future write, via services/staff.py
-- and services/auth.py) — no new code reads it after this migration lands.
--
-- down:
--   DROP TABLE user_roles;

CREATE TABLE IF NOT EXISTS user_roles (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, user_id, role)
);

ALTER TABLE user_roles ADD CONSTRAINT user_roles_role_check
    CHECK (role IN (
        'superadmin',
        'principal',
        'vice_principal',
        'class_teacher',
        'teacher',
        'accountant'
    ));

CREATE INDEX user_roles_tenant_role_idx ON user_roles (tenant_id, role);
CREATE INDEX user_roles_user_idx ON user_roles (user_id);

-- Backfill: every existing users.role becomes that user's sole held role.
INSERT INTO user_roles (tenant_id, user_id, role)
SELECT tenant_id, id, role FROM users
ON CONFLICT (tenant_id, user_id, role) DO NOTHING;
