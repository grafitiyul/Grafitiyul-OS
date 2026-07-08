-- Quote Offers — parallel commercial paths per deal (הצעה 1 / הצעה 2).
-- Within ONE offer, produced QuoteDocuments are numbered versions (v1, v2 …);
-- a newer produced version supersedes older unsigned ones. Offers never
-- supersede each other. Exactly one offer per deal is primary.
-- Additive + backfill only: no destructive change, legacy quote data is
-- attached to a new offer #1 per deal.

CREATE TABLE IF NOT EXISTS "QuoteOffer" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "offerNo" INTEGER NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "QuoteOffer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "QuoteOffer_dealId_offerNo_key" ON "QuoteOffer"("dealId", "offerNo");
CREATE INDEX IF NOT EXISTS "QuoteOffer_dealId_idx" ON "QuoteOffer"("dealId");

ALTER TABLE "QuoteOffer"
  ADD CONSTRAINT "QuoteOffer_dealId_fkey"
  FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuoteVersion" ADD COLUMN IF NOT EXISTS "offerId" TEXT;
ALTER TABLE "QuoteDocument" ADD COLUMN IF NOT EXISTS "offerId" TEXT;
ALTER TABLE "QuoteDocument" ADD COLUMN IF NOT EXISTS "versionNo" INTEGER;

CREATE INDEX IF NOT EXISTS "QuoteVersion_offerId_idx" ON "QuoteVersion"("offerId");
CREATE INDEX IF NOT EXISTS "QuoteDocument_offerId_idx" ON "QuoteDocument"("offerId");
-- Two concurrent produce calls can never mint the same version number
-- (drafts keep versionNo NULL, which the unique index ignores).
CREATE UNIQUE INDEX IF NOT EXISTS "QuoteDocument_offerId_versionNo_key" ON "QuoteDocument"("offerId", "versionNo");

ALTER TABLE "QuoteVersion"
  ADD CONSTRAINT "QuoteVersion_offerId_fkey"
  FOREIGN KEY ("offerId") REFERENCES "QuoteOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "QuoteDocument"
  ADD CONSTRAINT "QuoteDocument_offerId_fkey"
  FOREIGN KEY ("offerId") REFERENCES "QuoteOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: one primary offer #1 for every deal that already has quote data.
-- Raw-SQL ids (Prisma cuids are app-side); any unique TEXT id is valid.
INSERT INTO "QuoteOffer" ("id", "dealId", "offerNo", "isPrimary", "createdAt", "updatedAt")
SELECT 'qoffer_' || md5(d."dealId" || clock_timestamp()::text), d."dealId", 1, true, NOW(), NOW()
FROM (
  SELECT "dealId" FROM "QuoteVersion"
  UNION
  SELECT "dealId" FROM "QuoteDocument"
) d
ON CONFLICT ("dealId", "offerNo") DO NOTHING;

UPDATE "QuoteVersion" v
SET "offerId" = o."id"
FROM "QuoteOffer" o
WHERE o."dealId" = v."dealId" AND o."offerNo" = 1 AND v."offerId" IS NULL;

UPDATE "QuoteDocument" q
SET "offerId" = o."id"
FROM "QuoteOffer" o
WHERE o."dealId" = q."dealId" AND o."offerNo" = 1 AND q."offerId" IS NULL;

-- Version numbers for documents that were already produced/signed (chronological
-- within their offer). Drafts stay NULL — versionNo is assigned at produce time.
UPDATE "QuoteDocument" q
SET "versionNo" = n.rn
FROM (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "offerId"
    ORDER BY COALESCE("producedAt", "createdAt") ASC
  ) AS rn
  FROM "QuoteDocument"
  WHERE "status" <> 'draft'
) n
WHERE q."id" = n."id" AND q."versionNo" IS NULL;
