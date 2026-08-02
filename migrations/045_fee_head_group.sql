-- 045_fee_head_group.sql
-- Groups fee heads so a set of them can be switched on/off together.
--
-- Driver (owner, 2026-08-02): DPS charges admission once, at first admission
-- -- not once per class -- but Admission Fee, Admission Form, Development Fee
-- (Admission) and Building Fee all had all-classes schedules levying them on
-- every one of the 406 students each generation. Those schedules and their
-- 1,624 ledger rows (Rs.7,30,800) were removed; the heads themselves stay
-- active so they can be applied to new admissions on purpose.
--
-- `fee_group` tags which heads move together. The group's on/off state lives
-- in tenants.feature_flags ("admission_fees_active"), NOT here: an absent flag
-- reads as off, so "default deactivated" needs no backfill and no per-tenant
-- row. Only principal/accountant may flip it.
--
-- Nullable and unconstrained on purpose -- every existing head stays ungrouped
-- and behaves exactly as before. Registration Fee is deliberately NOT tagged
-- (owner: "dont add registertion fee ANYWHERE").
--
-- down:
--   DROP INDEX IF EXISTS fee_heads_tenant_group_idx;
--   ALTER TABLE fee_heads DROP COLUMN IF EXISTS fee_group;

ALTER TABLE fee_heads ADD COLUMN IF NOT EXISTS fee_group TEXT;

-- Composite index leads with tenant_id per the multi-tenancy rule; partial
-- because grouped heads are a small minority of the table.
CREATE INDEX IF NOT EXISTS fee_heads_tenant_group_idx
    ON fee_heads (tenant_id, fee_group)
    WHERE fee_group IS NOT NULL;
