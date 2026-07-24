-- 044_tenant_alt_slug.sql
-- Lets a tenant resolve on a second subdomain without renaming its primary
-- slug (owner request: PMIC wants pcmintercollege.tulipsedu.in to work
-- alongside the existing premchandmahtoic.tulipsedu.in -- real staff/parent
-- logins already point at the old one, so it must keep working, not be
-- replaced). No nginx/DNS change needed: *.tulipsedu.in already has
-- wildcard DNS + a wildcard TLS cert, so any new subdomain already reaches
-- this app -- only the tenant lookup needs to also match alt_slug.
--
-- down:
--   ALTER TABLE tenants DROP COLUMN alt_slug;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS alt_slug VARCHAR(63) UNIQUE;
