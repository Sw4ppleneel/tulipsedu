-- 035_admissions_tenant_cascade.sql
-- admissions.tenant_id referenced tenants(id) WITHOUT ON DELETE CASCADE — the only
-- tenant-owned table missing it. This blocked tenant deletion (a leaked ephemeral
-- test tenant could not be cleaned up because its admissions rows held the FK) and
-- is a multi-tenant consistency gap. Re-create the FK with ON DELETE CASCADE so a
-- tenant delete cascades to its admissions like every other child table.
--
-- down:
--   ALTER TABLE admissions DROP CONSTRAINT admissions_tenant_id_fkey;
--   ALTER TABLE admissions ADD CONSTRAINT admissions_tenant_id_fkey
--       FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE admissions DROP CONSTRAINT admissions_tenant_id_fkey;

ALTER TABLE admissions
    ADD CONSTRAINT admissions_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
