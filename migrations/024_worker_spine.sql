-- 024_worker_spine.sql
-- Workflow spine: event-consumer cursor, dead-letter queue, in-app notifications,
-- and fee-reminder dedup. audit_events itself stays untouched (immutable, append-only);
-- the worker tracks its own position in worker_cursors.
--
-- Down:
--   DROP TABLE notifications;
--   DROP TABLE worker_dlq;
--   DROP TABLE worker_cursors;
--   ALTER TABLE fee_ledger DROP COLUMN reminded_at;

-- ── 1. Consumer cursor ──────────────────────────────────────────────────────
-- Platform-level component (like schema_migrations): no tenant_id by design.
-- One row per consumer; the single worker uses consumer = 'main'.
CREATE TABLE IF NOT EXISTS worker_cursors (
    consumer      VARCHAR(50) PRIMARY KEY,
    last_event_id BIGINT NOT NULL DEFAULT 0,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Bootstrap at the current head so historical events are NOT replayed on first deploy.
INSERT INTO worker_cursors (consumer, last_event_id)
SELECT 'main', COALESCE(MAX(id), 0) FROM audit_events
ON CONFLICT (consumer) DO NOTHING;

-- ── 2. Dead-letter queue ────────────────────────────────────────────────────
-- Failed handler runs. Carries a self-contained copy of the event so retries
-- never need to re-read (or mutate) audit_events. tenant_id kept for traceability.
CREATE TABLE IF NOT EXISTS worker_dlq (
    id            BIGSERIAL PRIMARY KEY,
    event_id      BIGINT NOT NULL,
    tenant_id     UUID NOT NULL,
    handler       VARCHAR(100) NOT NULL,
    event_type    VARCHAR(100) NOT NULL,
    payload       JSONB NOT NULL,
    error         TEXT NOT NULL,
    attempts      INT NOT NULL DEFAULT 1,
    next_retry_at TIMESTAMPTZ NOT NULL,
    resolved_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS worker_dlq_retry_idx
    ON worker_dlq (next_retry_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS worker_dlq_tenant_idx
    ON worker_dlq (tenant_id, created_at);

-- ── 3. In-app notifications ─────────────────────────────────────────────────
-- recipient_type 'user'             → recipient_id = users.id   (staff)
-- recipient_type 'parent_of_student'→ recipient_id = students.id (parent JWT sub)
CREATE TABLE IF NOT EXISTS notifications (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    recipient_type VARCHAR(20) NOT NULL
                   CHECK (recipient_type IN ('user', 'parent_of_student')),
    recipient_id   UUID NOT NULL,
    type           VARCHAR(50) NOT NULL,
    -- ABSENT | FEE_RECEIPT | FEE_RECONCILE | HOMEWORK | EXAM_PUBLISHED | FEE_OVERDUE
    title          VARCHAR(200) NOT NULL,
    body           TEXT NOT NULL DEFAULT '',
    ref            VARCHAR(120),
    -- dedup key per type: session_id / payment_id / post_id / term_id / ledger_id
    read_at        TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_recipient_idx
    ON notifications (tenant_id, recipient_type, recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_unread_idx
    ON notifications (tenant_id, recipient_type, recipient_id) WHERE read_at IS NULL;
-- Idempotency anchor: handlers INSERT ... ON CONFLICT DO NOTHING against this,
-- making at-least-once event delivery safe.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedup_idx
    ON notifications (tenant_id, recipient_type, recipient_id, type, ref)
    WHERE ref IS NOT NULL;

-- ── 4. Fee reminder dedup ───────────────────────────────────────────────────
-- Lets the overdue scheduler filter in SQL (reminded_at IS NULL) instead of
-- re-attempting conflicting inserts every scan; supports future escalation.
ALTER TABLE fee_ledger ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ;
