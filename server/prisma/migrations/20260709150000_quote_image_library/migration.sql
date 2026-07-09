-- Quote Image Library — images become independent, reusable entities.
-- Ownership is REVERSED: a Product Variant no longer owns/uploads quote images;
-- it references library images per quote position (hero | slot1 | slot2).
-- Additive + backfill only, no destructive change:
--   1. QuoteTemplate.layout->'images' (the old JSON library: slot + variantIds
--      per image) → QuoteImage rows + ProductVariantQuoteImage links, so every
--      existing image keeps appearing in exactly the same quotes.
--   2. Legacy per-variant gallery uploads (ProductVariantImage) → library rows
--      (deduped by media file) so nothing the operator uploaded is lost. NO
--      links are created for them — the hero fallback chain still reads the
--      legacy gallery unchanged, so rendered output is identical.
--   3. Every backfilled image is tagged with the locations of the variants
--      that referenced/uploaded it ("applicable locations" seed).

CREATE TABLE IF NOT EXISTS "QuoteImage" (
    "id" TEXT NOT NULL,
    "mediaFileId" TEXT NOT NULL,
    "titleHe" TEXT,
    "titleEn" TEXT,
    "description" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "QuoteImage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "QuoteImage_sortOrder_idx" ON "QuoteImage"("sortOrder");

ALTER TABLE "QuoteImage"
  ADD CONSTRAINT "QuoteImage_mediaFileId_fkey"
  FOREIGN KEY ("mediaFileId") REFERENCES "MediaFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "QuoteImageLocation" (
    "quoteImageId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    CONSTRAINT "QuoteImageLocation_pkey" PRIMARY KEY ("quoteImageId", "locationId")
);

CREATE INDEX IF NOT EXISTS "QuoteImageLocation_locationId_idx" ON "QuoteImageLocation"("locationId");

ALTER TABLE "QuoteImageLocation"
  ADD CONSTRAINT "QuoteImageLocation_quoteImageId_fkey"
  FOREIGN KEY ("quoteImageId") REFERENCES "QuoteImage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuoteImageLocation"
  ADD CONSTRAINT "QuoteImageLocation_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "ProductVariantQuoteImage" (
    "id" TEXT NOT NULL,
    "productVariantId" TEXT NOT NULL,
    "quoteImageId" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ProductVariantQuoteImage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PVQuoteImage_variant_position_image_key"
  ON "ProductVariantQuoteImage"("productVariantId", "position", "quoteImageId");
CREATE INDEX IF NOT EXISTS "ProductVariantQuoteImage_productVariantId_idx"
  ON "ProductVariantQuoteImage"("productVariantId");
CREATE INDEX IF NOT EXISTS "ProductVariantQuoteImage_quoteImageId_idx"
  ON "ProductVariantQuoteImage"("quoteImageId");

ALTER TABLE "ProductVariantQuoteImage"
  ADD CONSTRAINT "ProductVariantQuoteImage_productVariantId_fkey"
  FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductVariantQuoteImage"
  ADD CONSTRAINT "ProductVariantQuoteImage_quoteImageId_fkey"
  FOREIGN KEY ("quoteImageId") REFERENCES "QuoteImage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Backfill 1: old JSON library → QuoteImage rows (captions become titles) ──
-- Image ids from the JSON are stable client-minted strings ('img_…') — reused
-- verbatim as PKs so the link backfill below can join on them.
INSERT INTO "QuoteImage" ("id", "mediaFileId", "titleHe", "titleEn", "sortOrder", "createdAt", "updatedAt")
SELECT
  im.value->>'id',
  im.value->'image'->>'id',
  NULLIF(TRIM(COALESCE(im.value->>'captionHe', '')), ''),
  NULLIF(TRIM(COALESCE(im.value->>'captionEn', '')), ''),
  (im.ordinality - 1)::int,
  NOW(),
  NOW()
FROM "QuoteTemplate" t
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(t."layout"->'images') = 'array' THEN t."layout"->'images' ELSE '[]'::jsonb END
) WITH ORDINALITY AS im(value, ordinality)
WHERE t."singleton" = 'global'
  AND COALESCE(im.value->>'id', '') <> ''
  AND COALESCE(im.value->'image'->>'id', '') <> ''
  AND EXISTS (SELECT 1 FROM "MediaFile" m WHERE m."id" = im.value->'image'->>'id')
ON CONFLICT ("id") DO NOTHING;

-- ── Backfill 2: old per-image targeting (slot + variantIds) → variant links ──
INSERT INTO "ProductVariantQuoteImage" ("id", "productVariantId", "quoteImageId", "position", "sortOrder")
SELECT
  'pvqi_' || md5((im.value->>'id') || ':' || vid.value),
  vid.value,
  im.value->>'id',
  CASE WHEN im.value->>'slot' = 'slot2' THEN 'slot2' ELSE 'slot1' END,
  0
FROM "QuoteTemplate" t
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(t."layout"->'images') = 'array' THEN t."layout"->'images' ELSE '[]'::jsonb END
) AS im(value)
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE WHEN jsonb_typeof(im.value->'variantIds') = 'array' THEN im.value->'variantIds' ELSE '[]'::jsonb END
) AS vid(value)
WHERE t."singleton" = 'global'
  AND EXISTS (SELECT 1 FROM "QuoteImage" q WHERE q."id" = im.value->>'id')
  AND EXISTS (SELECT 1 FROM "ProductVariant" v WHERE v."id" = vid.value)
ON CONFLICT DO NOTHING;

-- ── Backfill 3: legacy variant gallery uploads → library rows (dedup by media) ──
INSERT INTO "QuoteImage" ("id", "mediaFileId", "sortOrder", "createdAt", "updatedAt")
SELECT 'qimg_' || md5(g."mediaFileId"), g."mediaFileId", 1000, NOW(), NOW()
FROM (SELECT DISTINCT "mediaFileId" FROM "ProductVariantImage") g
WHERE NOT EXISTS (SELECT 1 FROM "QuoteImage" q WHERE q."mediaFileId" = g."mediaFileId")
ON CONFLICT ("id") DO NOTHING;

-- ── Backfill 4: seed "applicable locations" from actual usage ──
INSERT INTO "QuoteImageLocation" ("quoteImageId", "locationId")
SELECT DISTINCT l."quoteImageId", v."locationId"
FROM "ProductVariantQuoteImage" l
JOIN "ProductVariant" v ON v."id" = l."productVariantId"
ON CONFLICT DO NOTHING;

INSERT INTO "QuoteImageLocation" ("quoteImageId", "locationId")
SELECT DISTINCT q."id", v."locationId"
FROM "ProductVariantImage" g
JOIN "QuoteImage" q ON q."mediaFileId" = g."mediaFileId"
JOIN "ProductVariant" v ON v."id" = g."productVariantId"
ON CONFLICT DO NOTHING;
