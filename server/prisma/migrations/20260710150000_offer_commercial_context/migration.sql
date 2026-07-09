-- Offer-owned commercial context. INVARIANT: the PRIMARY offer is always
-- contextMode='deal' (the Deal IS the primary offer's commercial truth);
-- non-primary parallel offers are contextMode='own' and compose from their own
-- product/variant/location/participants/date/time/valueMinor — immune to Deal
-- edits. Additive + backfill only.

ALTER TABLE "QuoteOffer" ADD COLUMN IF NOT EXISTS "contextMode" TEXT NOT NULL DEFAULT 'deal';
ALTER TABLE "QuoteOffer" ADD COLUMN IF NOT EXISTS "productId" TEXT;
ALTER TABLE "QuoteOffer" ADD COLUMN IF NOT EXISTS "productVariantId" TEXT;
ALTER TABLE "QuoteOffer" ADD COLUMN IF NOT EXISTS "locationId" TEXT;
ALTER TABLE "QuoteOffer" ADD COLUMN IF NOT EXISTS "participants" INTEGER;
ALTER TABLE "QuoteOffer" ADD COLUMN IF NOT EXISTS "tourDate" TEXT;
ALTER TABLE "QuoteOffer" ADD COLUMN IF NOT EXISTS "tourTime" TEXT;
ALTER TABLE "QuoteOffer" ADD COLUMN IF NOT EXISTS "valueMinor" BIGINT;

ALTER TABLE "QuoteOffer"
  ADD CONSTRAINT "QuoteOffer_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "QuoteOffer"
  ADD CONSTRAINT "QuoteOffer_productVariantId_fkey"
  FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "QuoteOffer"
  ADD CONSTRAINT "QuoteOffer_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: every NON-primary offer (archived included — it may be restored)
-- becomes 'own', seeded from its deal's CURRENT context. Primary offers stay
-- 'deal' — they mirror the Deal by definition. Deals whose offers diverged
-- before this model existed keep composing from the current deal until the
-- operator re-picks that offer's product in the workspace.
UPDATE "QuoteOffer" o
SET "contextMode"   = 'own',
    "productId"        = d."productId",
    "productVariantId" = d."productVariantId",
    "locationId"       = d."locationId",
    "participants"     = d."participants",
    "tourDate"         = d."tourDate",
    "tourTime"         = d."tourTime",
    "valueMinor"       = d."valueMinor"
FROM "Deal" d
WHERE d."id" = o."dealId" AND o."isPrimary" = false;
