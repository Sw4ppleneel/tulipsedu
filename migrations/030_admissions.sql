-- 030_admissions.sql
-- Admissions pipeline: enquiry → application → docs_pending → approved → enrolled / rejected
--
-- On enrolment the orchestrated endpoint creates the student record and sets student_id here.
-- public_enquiry = TRUE means this record came from the public website form (JWT-exempt).
--
-- down:
--   DROP TABLE admissions CASCADE;

CREATE TABLE IF NOT EXISTS admissions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  status            VARCHAR(20) NOT NULL DEFAULT 'enquiry'
    CHECK (status IN ('enquiry', 'application', 'docs_pending', 'approved', 'enrolled', 'rejected')),
  applicant_name    VARCHAR(200) NOT NULL,
  applicant_dob     DATE,
  applying_class_id UUID REFERENCES classes(id),
  parent_name       VARCHAR(200),
  parent_phone      VARCHAR(15),
  notes             TEXT,
  student_id        UUID REFERENCES students(id),
  public_enquiry    BOOLEAN NOT NULL DEFAULT FALSE,
  rejected_reason   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admissions_tenant_status_idx ON admissions (tenant_id, status);
CREATE INDEX IF NOT EXISTS admissions_tenant_created_idx ON admissions (tenant_id, created_at DESC);
