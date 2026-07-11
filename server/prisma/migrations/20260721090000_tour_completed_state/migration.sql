-- Tour "Completed" becomes an explicit business state (not a midnight
-- derivation): completedAt stamps WHEN the tour completed (drives the tour
-- summary's 48h post-completion edit window), completedReason records WHY —
-- 'summaries' (all required guides submitted) | 'midnight' | 'manual'.
-- Purely additive.
ALTER TABLE "TourEvent" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);
ALTER TABLE "TourEvent" ADD COLUMN IF NOT EXISTS "completedReason" TEXT;
