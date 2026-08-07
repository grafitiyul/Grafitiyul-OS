-- Deal MERGE ("איחוד דילים") — lineage + audit.
--
-- Two deals turn out to be ONE real transaction. One survives; the other is
-- RETIRED, never deleted: every financial table cascades from Deal, so dropping
-- the row would silently destroy issued tax documents.
--
-- Purely ADDITIVE. No column is dropped, no row is rewritten, nothing existing
-- changes meaning: every pre-existing deal has mergedIntoDealId = NULL, which
-- is exactly "not retired".

-- ── Lineage on Deal ─────────────────────────────────────────────────────────
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "mergedIntoDealId" TEXT;
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "mergedAt"         TIMESTAMP(3);
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "mergeOpId"        TEXT;

-- Idempotency identity: the DATABASE answers "did this merge already run?",
-- so a double click / refresh / retry cannot produce two outcomes.
CREATE UNIQUE INDEX IF NOT EXISTS "Deal_mergeOpId_key" ON "Deal" ("mergeOpId");

-- Serves both halves of the lineage read: "is this deal retired?" (every
-- active-surface filter) and "what was retired into it?" (history, collection
-- and search aggregation).
CREATE INDEX IF NOT EXISTS "Deal_mergedIntoDealId_idx" ON "Deal" ("mergedIntoDealId");

-- RESTRICT, not CASCADE: a survivor can never be deleted out from under the
-- deals retired into it, which would orphan their lineage pointer.
ALTER TABLE "Deal"
  ADD CONSTRAINT "Deal_mergedIntoDealId_fkey"
  FOREIGN KEY ("mergedIntoDealId") REFERENCES "Deal"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── The merge audit record ──────────────────────────────────────────────────
CREATE TABLE "DealMerge" (
  "id"              TEXT NOT NULL,
  "survivorDealId"  TEXT NOT NULL,
  "survivorOrderNo" INTEGER NOT NULL,
  "retiredDealId"   TEXT NOT NULL,
  "retiredOrderNo"  INTEGER NOT NULL,
  "opId"            TEXT NOT NULL,
  "actorUserId"     TEXT,
  "actorName"       TEXT,
  "mergedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decisions"       JSONB NOT NULL,
  "outcome"         JSONB NOT NULL,
  CONSTRAINT "DealMerge_pkey" PRIMARY KEY ("id")
);

-- A deal is retired at MOST ONCE. A survivor may absorb many deals (chained
-- merges); a retired deal can never be retired again.
CREATE UNIQUE INDEX "DealMerge_retiredDealId_key" ON "DealMerge" ("retiredDealId");
CREATE UNIQUE INDEX "DealMerge_opId_key"          ON "DealMerge" ("opId");
CREATE INDEX "DealMerge_survivorDealId_idx"       ON "DealMerge" ("survivorDealId");
CREATE INDEX "DealMerge_mergedAt_idx"             ON "DealMerge" ("mergedAt");

-- RESTRICT on both sides: the audit record outlives nothing. Neither deal in a
-- recorded merge may be deleted while the record exists.
ALTER TABLE "DealMerge"
  ADD CONSTRAINT "DealMerge_survivorDealId_fkey"
  FOREIGN KEY ("survivorDealId") REFERENCES "Deal"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DealMerge"
  ADD CONSTRAINT "DealMerge_retiredDealId_fkey"
  FOREIGN KEY ("retiredDealId") REFERENCES "Deal"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
