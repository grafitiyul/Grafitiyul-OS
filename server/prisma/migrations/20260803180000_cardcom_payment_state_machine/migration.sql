-- Cardcom tourist payment — canonical state machine + duplicate-payment guards.
-- ADDITIVE: new nullable columns (+ attemptNo default 1), a status backfill that
-- only widens 'pending' rows that already hold a LowProfile into
-- 'awaiting_payment', and a WIDER partial-unique predicate. No data is deleted,
-- no historical provider evidence is rewritten, no row is marked paid.
--
-- New states: pending → awaiting_payment → payment_returned → paid | failed
-- (canceled unchanged; 'expired' reserved). The one-active-request-per-deal
-- invariant now covers every non-terminal state, so the new states cannot leak
-- a second concurrent request past the old WHERE status='pending' predicate.
--
-- Defensive (IF NOT EXISTS / IF EXISTS) so it is safe to re-run.

ALTER TABLE "PaymentRequest" ADD COLUMN IF NOT EXISTS "returnedAt"     TIMESTAMP(3);
ALTER TABLE "PaymentRequest" ADD COLUMN IF NOT EXISTS "webhookAt"      TIMESTAMP(3);
ALTER TABLE "PaymentRequest" ADD COLUMN IF NOT EXISTS "lastVerifyAt"   TIMESTAMP(3);
ALTER TABLE "PaymentRequest" ADD COLUMN IF NOT EXISTS "attemptNo"      INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PaymentRequest" ADD COLUMN IF NOT EXISTS "attemptHistory" JSONB;
ALTER TABLE "PaymentRequest" ADD COLUMN IF NOT EXISTS "failReason"     TEXT;
ALTER TABLE "PaymentRequest" ADD COLUMN IF NOT EXISTS "verifyHold"     TEXT;

-- Classification backfill (safe, additive):
--   no LowProfile            → stays 'pending'
--   LowProfile, not paid     → 'awaiting_payment'
--   paid / canceled          → untouched
-- Never marks anything paid from redirect fields (none exist yet anyway).
UPDATE "PaymentRequest"
   SET "status" = 'awaiting_payment'
 WHERE "provider" = 'cardcom'
   AND "status" = 'pending'
   AND "cardcomLowProfileId" IS NOT NULL;

-- Widen the one-active-per-deal invariant to the full active-state set BEFORE
-- dropping the old predicate, so there is no unguarded window.
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentRequest_one_active_cardcom_per_deal"
  ON "PaymentRequest"("dealId")
  WHERE "status" IN ('pending', 'awaiting_payment', 'payment_returned', 'failed')
    AND "provider" = 'cardcom';

DROP INDEX IF EXISTS "PaymentRequest_one_pending_cardcom_per_deal";
