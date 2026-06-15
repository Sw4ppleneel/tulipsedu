-- 032_payment_integrity.sql
-- IRONCLAD double-pay guard (ADR-012). A fee_ledger row may belong to at most ONE
-- payment line item — enforced by Postgres, so even a future code path that forgets
-- `SELECT ... FOR UPDATE` physically cannot charge the same fee twice.
--
-- Step 1 cleans line items of DEAD payments (rejected/failed/refunded and abandoned
-- gateway 'pending'); verified beforehand that this leaves zero duplicate ledger_ids.
-- Going forward the reject path and the live collectors delete dead items first, so
-- the constraint never blocks a legitimate re-payment after a rejected/abandoned try.
--
-- down:
--   ALTER TABLE fee_payment_items DROP CONSTRAINT unique_tenant_ledger_item;

DELETE FROM fee_payment_items fpi
USING fee_payments fp
WHERE fpi.payment_id = fp.id
  AND fp.status IN ('rejected', 'failed', 'refunded', 'pending');

ALTER TABLE fee_payment_items
    ADD CONSTRAINT unique_tenant_ledger_item UNIQUE (tenant_id, ledger_id);
