-- 031_payroll.sql
-- Consolidated payroll (no statutory PF/ESI/TDS auto-calc — see ADR-011).
-- Each staff member has one salary structure (gross + recurring allowance/deduction
-- lines). A monthly payroll run snapshots a payslip per staff from that structure;
-- payslips are editable while the run is 'draft' and frozen once 'finalized'.
--
-- Components / allowances / deductions are JSONB arrays of {name, amount} objects
-- (salary_structure.components also carries a "type": 'allowance' | 'deduction').
-- net_salary = gross_salary + SUM(allowances) − SUM(deductions).
--
-- down:
--   DROP TABLE staff_payslips CASCADE;
--   DROP TABLE staff_payroll_runs CASCADE;
--   DROP TABLE staff_salary_structures CASCADE;

CREATE TABLE IF NOT EXISTS staff_salary_structures (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    staff_id       UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    gross_salary   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (gross_salary >= 0),
    components     JSONB NOT NULL DEFAULT '[]',
    effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_salary_structure_staff UNIQUE (tenant_id, staff_id)
);

CREATE TABLE IF NOT EXISTS staff_payroll_runs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    period_month SMALLINT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
    period_year  SMALLINT NOT NULL,
    status       VARCHAR(20) NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'finalized')),
    created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finalized_at TIMESTAMPTZ,
    CONSTRAINT uq_payroll_run_period UNIQUE (tenant_id, period_year, period_month)
);

CREATE TABLE IF NOT EXISTS staff_payslips (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    run_id       UUID NOT NULL REFERENCES staff_payroll_runs(id) ON DELETE CASCADE,
    staff_id     UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    gross_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
    allowances   JSONB NOT NULL DEFAULT '[]',
    deductions   JSONB NOT NULL DEFAULT '[]',
    net_salary   NUMERIC(12,2) NOT NULL DEFAULT 0,
    note         TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_payslip_run_staff UNIQUE (tenant_id, run_id, staff_id)
);

-- Composite indexes lead with tenant_id (tenant-isolation rule).
CREATE INDEX IF NOT EXISTS salary_structure_tenant_idx ON staff_salary_structures (tenant_id);
CREATE INDEX IF NOT EXISTS payroll_runs_tenant_period_idx ON staff_payroll_runs (tenant_id, period_year, period_month);
CREATE INDEX IF NOT EXISTS payslips_tenant_run_idx ON staff_payslips (tenant_id, run_id);
CREATE INDEX IF NOT EXISTS payslips_tenant_staff_idx ON staff_payslips (tenant_id, staff_id);
