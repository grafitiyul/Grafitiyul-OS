-- Second-stage collection matching: shared historical documents + the operator
-- review queue.
--
-- 1. IcountDocument gains the two fields that make the owner's shared-document
--    ruling safe: a flag marking the relationship, and the amount THIS deal
--    counts. Company-level totals dedupe by (doctype, docnum), so one document
--    settling twenty deals still contributes its own amount exactly once.
-- 2. CollectionMatchCandidate is the review queue — a suggestion with all the
--    evidence attached, never evidence in itself.
--
-- Both additive; nothing existing is altered or dropped.

ALTER TABLE "IcountDocument"
  ADD COLUMN "sharedHistorical" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "allocationMinor"  BIGINT;

CREATE TABLE "CollectionMatchCandidate" (
  "id"             TEXT NOT NULL,
  "dealId"         TEXT NOT NULL,
  "doctype"        TEXT NOT NULL,
  "docnum"         TEXT NOT NULL,
  "tier"           TEXT NOT NULL DEFAULT 'B',
  "score"          INTEGER NOT NULL DEFAULT 0,
  "basis"          JSONB,
  "question"       TEXT NOT NULL,
  "competingDeals" JSONB,
  "competingDocs"  JSONB,
  "status"         TEXT NOT NULL DEFAULT 'open',
  "resolvedAt"     TIMESTAMP(3),
  "resolvedBy"     TEXT,
  "resolvedByName" TEXT,
  "resolutionNote" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CollectionMatchCandidate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CollectionMatchCandidate_dealId_doctype_docnum_key"
  ON "CollectionMatchCandidate"("dealId", "doctype", "docnum");
CREATE INDEX "CollectionMatchCandidate_status_score_idx" ON "CollectionMatchCandidate"("status", "score");
CREATE INDEX "CollectionMatchCandidate_dealId_idx"       ON "CollectionMatchCandidate"("dealId");

ALTER TABLE "CollectionMatchCandidate"
  ADD CONSTRAINT "CollectionMatchCandidate_dealId_fkey"
  FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
