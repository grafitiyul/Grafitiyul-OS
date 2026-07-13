-- Conditional (HELD) registration lifecycle on the canonical TicketRegistration.
-- Purely additive: new nullable columns default safely; existing rows keep
-- status='active' (treated as confirmed). No status value is renamed.
ALTER TABLE "TicketRegistration" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);
ALTER TABLE "TicketRegistration" ADD COLUMN IF NOT EXISTS "heldAt" TIMESTAMP(3);
ALTER TABLE "TicketRegistration" ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMP(3);
ALTER TABLE "TicketRegistration" ADD COLUMN IF NOT EXISTS "expiredAt" TIMESTAMP(3);
ALTER TABLE "TicketRegistration" ADD COLUMN IF NOT EXISTS "noPaymentReason" TEXT;

CREATE INDEX IF NOT EXISTS "TicketRegistration_status_expiresAt_idx" ON "TicketRegistration"("status", "expiresAt");
