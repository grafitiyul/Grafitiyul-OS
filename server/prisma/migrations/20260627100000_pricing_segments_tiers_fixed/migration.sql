-- Products & Pricing — Slice A: Pricing Segments + Tier ladder + fixed/per-group models.
--
-- ADDITIVE ONLY. New tables (PricingSegment, PriceTier), four new nullable
-- columns on PriceRule (pricingSegmentId, cardGroupId, fixedPriceMinor — plus the
-- existing priceModel column simply gains two new allowed string values, no DDL),
-- their FKs, indexes, and a seed of the 6 business tabs with NO bindings. Nothing
-- is dropped or rewritten; no Deal/Quote tables are touched. Written defensively
-- (IF NOT EXISTS + guarded constraints) so it is safe to run once and harmless if
-- any object already exists.

-- ── New tables ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "PriceTier" (
    "id" TEXT NOT NULL,
    "priceRuleId" TEXT NOT NULL,
    "uptoParticipants" INTEGER NOT NULL,
    "totalPriceMinor" BIGINT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceTier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PricingSegment" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nameHe" TEXT NOT NULL,
    "nameEn" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "activityTypeId" TEXT,
    "organizationSubtypeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PricingSegment_pkey" PRIMARY KEY ("id")
);

-- ── New columns on PriceRule ────────────────────────────────────────────────

ALTER TABLE "PriceRule" ADD COLUMN IF NOT EXISTS "pricingSegmentId" TEXT;
ALTER TABLE "PriceRule" ADD COLUMN IF NOT EXISTS "cardGroupId" TEXT;
ALTER TABLE "PriceRule" ADD COLUMN IF NOT EXISTS "fixedPriceMinor" BIGINT;

-- ── Indexes ─────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS "PricingSegment_key_key" ON "PricingSegment"("key");
CREATE INDEX IF NOT EXISTS "PricingSegment_sortOrder_idx" ON "PricingSegment"("sortOrder");
CREATE INDEX IF NOT EXISTS "PriceTier_priceRuleId_idx" ON "PriceTier"("priceRuleId");
CREATE INDEX IF NOT EXISTS "PriceRule_pricingSegmentId_idx" ON "PriceRule"("pricingSegmentId");
CREATE INDEX IF NOT EXISTS "PriceRule_cardGroupId_idx" ON "PriceRule"("cardGroupId");

-- ── Foreign keys (each added only if missing) ───────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PriceTier_priceRuleId_fkey') THEN
    ALTER TABLE "PriceTier" ADD CONSTRAINT "PriceTier_priceRuleId_fkey" FOREIGN KEY ("priceRuleId") REFERENCES "PriceRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PriceRule_pricingSegmentId_fkey') THEN
    ALTER TABLE "PriceRule" ADD CONSTRAINT "PriceRule_pricingSegmentId_fkey" FOREIGN KEY ("pricingSegmentId") REFERENCES "PricingSegment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PricingSegment_activityTypeId_fkey') THEN
    ALTER TABLE "PricingSegment" ADD CONSTRAINT "PricingSegment_activityTypeId_fkey" FOREIGN KEY ("activityTypeId") REFERENCES "ActivityType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PricingSegment_organizationSubtypeId_fkey') THEN
    ALTER TABLE "PricingSegment" ADD CONSTRAINT "PricingSegment_organizationSubtypeId_fkey" FOREIGN KEY ("organizationSubtypeId") REFERENCES "OrganizationSubtype"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ── Seed the 6 business tabs (names only, NO bindings) — idempotent by key ───
-- Bindings (activityTypeId / organizationSubtypeId) are intentionally left NULL;
-- the owner sets them from the admin UI. No hard-coded org mappings.

INSERT INTO "PricingSegment" ("id","key","nameHe","nameEn","sortOrder","active","createdAt","updatedAt")
SELECT 'pricing_segment_group','group','קבוצתי','Group',0,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "PricingSegment" WHERE "key" = 'group');

INSERT INTO "PricingSegment" ("id","key","nameHe","nameEn","sortOrder","active","createdAt","updatedAt")
SELECT 'pricing_segment_private','private','פרטי','Private',1,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "PricingSegment" WHERE "key" = 'private');

INSERT INTO "PricingSegment" ("id","key","nameHe","nameEn","sortOrder","active","createdAt","updatedAt")
SELECT 'pricing_segment_business','business','עסקי','Business',2,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "PricingSegment" WHERE "key" = 'business');

INSERT INTO "PricingSegment" ("id","key","nameHe","nameEn","sortOrder","active","createdAt","updatedAt")
SELECT 'pricing_segment_school','school','בית ספר','School',3,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "PricingSegment" WHERE "key" = 'school');

INSERT INTO "PricingSegment" ("id","key","nameHe","nameEn","sortOrder","active","createdAt","updatedAt")
SELECT 'pricing_segment_agents','agents','סוכנים','Agents',4,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "PricingSegment" WHERE "key" = 'agents');

INSERT INTO "PricingSegment" ("id","key","nameHe","nameEn","sortOrder","active","createdAt","updatedAt")
SELECT 'pricing_segment_producers','producers','מפיקים','Producers',5,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "PricingSegment" WHERE "key" = 'producers');
