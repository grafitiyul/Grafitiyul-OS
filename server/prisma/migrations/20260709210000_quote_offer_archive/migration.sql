-- Soft removal for parallel offers. An offer with generated documents is
-- archived (hidden from the workspace tabs, history stays intact); only an
-- offer that never generated anything may be hard-deleted. Additive only.
ALTER TABLE "QuoteOffer" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
