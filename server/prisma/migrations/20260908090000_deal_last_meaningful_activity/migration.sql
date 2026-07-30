-- Canonical Deal.lastMeaningfulActivityAt (2026-07-30) — the Deals list orders
-- by this, never by the technical updatedAt.
--
-- DELIBERATELY two-step: ADD COLUMN without a default leaves every EXISTING
-- row NULL (Postgres only fast-fills existing rows when the ADD carries the
-- default) — those get their REAL latest activity from the controlled
-- backfill (scripts/deals/backfill-deal-activity.mjs), not the migration
-- moment. SET DEFAULT afterwards covers every future INSERT: creating a deal
-- is itself meaningful activity.
ALTER TABLE "Deal" ADD COLUMN "lastMeaningfulActivityAt" TIMESTAMP(3);
ALTER TABLE "Deal" ALTER COLUMN "lastMeaningfulActivityAt" SET DEFAULT CURRENT_TIMESTAMP;

-- Serves the list's default ORDER BY … DESC with pagination.
CREATE INDEX "Deal_lastMeaningfulActivityAt_idx" ON "Deal"("lastMeaningfulActivityAt");
