-- Canonical line storage: QuoteVersion + QuoteLine (replaces Deal.priceLines JSON).
--
-- One working QuoteVersion per deal holds the Price Builder's lines. No quote
-- workflow yet — additive structure only. Steps:
--   1) create the two tables (+ FKs + indexes), defensively;
--   2) backfill any existing Deal.priceLines JSON into rows (no-op if none — the
--      JSON was never actually persisted, so this is a safety net only);
--   3) drop Deal.priceLines (the canonical model is now the single source).
-- Safe to re-run.

-- ── 1) Tables ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "QuoteVersion" (
  "id"         TEXT NOT NULL,
  "dealId"     TEXT NOT NULL,
  "status"     TEXT NOT NULL DEFAULT 'draft',
  "isWorking"  BOOLEAN NOT NULL DEFAULT true,
  "isSelected" BOOLEAN NOT NULL DEFAULT false,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuoteVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "QuoteLine" (
  "id"               TEXT NOT NULL,
  "quoteVersionId"   TEXT NOT NULL,
  "kind"             TEXT NOT NULL,
  "label"            TEXT NOT NULL DEFAULT '',
  "productVariantId" TEXT,
  "addonId"          TEXT,
  "quantity"         INTEGER NOT NULL DEFAULT 1,
  "unitPriceMinor"   BIGINT NOT NULL DEFAULT 0,
  "vatMode"          TEXT NOT NULL DEFAULT 'inherit',
  "vatRate"          INTEGER,
  "active"           BOOLEAN NOT NULL DEFAULT true,
  "note"             TEXT,
  "overridden"       BOOLEAN NOT NULL DEFAULT false,
  "sortOrder"        INTEGER NOT NULL DEFAULT 0,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuoteLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "QuoteVersion_dealId_idx" ON "QuoteVersion"("dealId");
CREATE INDEX IF NOT EXISTS "QuoteLine_quoteVersionId_idx" ON "QuoteLine"("quoteVersionId");
CREATE INDEX IF NOT EXISTS "QuoteLine_productVariantId_idx" ON "QuoteLine"("productVariantId");
CREATE INDEX IF NOT EXISTS "QuoteLine_addonId_idx" ON "QuoteLine"("addonId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'QuoteVersion_dealId_fkey') THEN
    ALTER TABLE "QuoteVersion" ADD CONSTRAINT "QuoteVersion_dealId_fkey"
      FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'QuoteLine_quoteVersionId_fkey') THEN
    ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_quoteVersionId_fkey"
      FOREIGN KEY ("quoteVersionId") REFERENCES "QuoteVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'QuoteLine_productVariantId_fkey') THEN
    ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_productVariantId_fkey"
      FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'QuoteLine_addonId_fkey') THEN
    ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_addonId_fkey"
      FOREIGN KEY ("addonId") REFERENCES "Addon"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ── 2) Backfill existing Deal.priceLines (safety net; no-op when null/absent) ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Deal' AND column_name = 'priceLines'
  ) THEN
    -- One working version per deal that has a non-empty priceLines array and no
    -- working version yet.
    INSERT INTO "QuoteVersion" ("id", "dealId", "status", "isWorking", "isSelected", "createdAt", "updatedAt")
    SELECT gen_random_uuid()::text, d."id", 'draft', true, false, now(), now()
    FROM "Deal" d
    WHERE d."priceLines" IS NOT NULL
      AND jsonb_typeof(d."priceLines") = 'array'
      AND jsonb_array_length(d."priceLines") > 0
      AND NOT EXISTS (SELECT 1 FROM "QuoteVersion" qv WHERE qv."dealId" = d."id" AND qv."isWorking" = true);

    -- Lines from each deal's JSON, attached to its working version. Refs are kept
    -- only when they still resolve (FK-safe).
    INSERT INTO "QuoteLine" (
      "id", "quoteVersionId", "kind", "label", "productVariantId", "addonId",
      "quantity", "unitPriceMinor", "vatMode", "vatRate", "active", "note", "overridden", "sortOrder", "createdAt", "updatedAt"
    )
    SELECT
      gen_random_uuid()::text,
      qv."id",
      COALESCE(elem->>'kind', 'manual'),
      COALESCE(elem->>'label', ''),
      CASE WHEN COALESCE(elem->>'kind','') = 'product'
             AND EXISTS (SELECT 1 FROM "ProductVariant" pv WHERE pv."id" = NULLIF(elem->>'refId',''))
           THEN NULLIF(elem->>'refId','') END,
      CASE WHEN COALESCE(elem->>'kind','') = 'addon'
             AND EXISTS (SELECT 1 FROM "Addon" a WHERE a."id" = NULLIF(elem->>'refId',''))
           THEN NULLIF(elem->>'refId','') END,
      COALESCE((elem->>'quantity')::numeric::int, 1),
      COALESCE((elem->>'unitPriceMinor')::numeric::bigint, 0),
      COALESCE(NULLIF(elem->>'vatMode',''), 'inherit'),
      CASE WHEN NULLIF(elem->>'vatRate','') IS NULL THEN NULL ELSE (elem->>'vatRate')::numeric::int END,
      COALESCE((elem->>'active')::boolean, true),
      NULLIF(elem->>'note',''),
      COALESCE((elem->>'overridden')::boolean, false),
      (ord - 1)::int,
      now(), now()
    FROM "Deal" d
    JOIN "QuoteVersion" qv ON qv."dealId" = d."id" AND qv."isWorking" = true
    CROSS JOIN LATERAL jsonb_array_elements(d."priceLines") WITH ORDINALITY AS t(elem, ord)
    WHERE d."priceLines" IS NOT NULL
      AND jsonb_typeof(d."priceLines") = 'array'
      AND NOT EXISTS (SELECT 1 FROM "QuoteLine" ql WHERE ql."quoteVersionId" = qv."id");
  END IF;
END $$;

-- ── 3) Drop the JSON bridge — canonical model is now the single source ────────
ALTER TABLE "Deal" DROP COLUMN IF EXISTS "priceLines";
