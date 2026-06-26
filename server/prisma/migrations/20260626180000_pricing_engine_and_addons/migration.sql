-- Products & Pricing — Slice 2: Pricing Engine + Add-ons.
--
-- ADDITIVE ONLY. New tables (PriceList, PriceRule, Addon, AddonPriceRule), two
-- new nullable columns on existing tables (OrganizationType.defaultPriceListId,
-- OrganizationSubtype.defaultPriceListId), their FKs, indexes, and one seeded
-- system-default price list. Nothing is dropped or rewritten. Written
-- defensively (IF NOT EXISTS + guarded constraints) so it is safe to run once
-- and harmless if any object already exists.

-- ── New tables ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "PriceList" (
    "id" TEXT NOT NULL,
    "nameHe" TEXT NOT NULL,
    "nameEn" TEXT,
    "defaultVatMode" TEXT NOT NULL DEFAULT 'included',
    "defaultVatRate" INTEGER NOT NULL DEFAULT 18,
    "currency" TEXT NOT NULL DEFAULT 'ILS',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceList_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PriceRule" (
    "id" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "productId" TEXT,
    "productVariantId" TEXT,
    "activityTypeId" TEXT,
    "organizationSubtypeId" TEXT,
    "priceModel" TEXT NOT NULL,
    "adultPriceMinor" BIGINT,
    "childPriceMinor" BIGINT,
    "basePriceMinor" BIGINT,
    "baseParticipants" INTEGER,
    "perAdditionalParticipantMinor" BIGINT,
    "vatMode" TEXT,
    "vatRate" INTEGER,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Addon" (
    "id" TEXT NOT NULL,
    "nameHe" TEXT NOT NULL,
    "nameEn" TEXT,
    "defaultPriceMinor" BIGINT NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'ILS',
    "vatMode" TEXT NOT NULL DEFAULT 'included',
    "vatRate" INTEGER NOT NULL DEFAULT 18,
    "defaultQuantity" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Addon_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AddonPriceRule" (
    "id" TEXT NOT NULL,
    "addonId" TEXT NOT NULL,
    "priceListId" TEXT,
    "priceMinor" BIGINT NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'ILS',
    "vatMode" TEXT NOT NULL DEFAULT 'included',
    "vatRate" INTEGER NOT NULL DEFAULT 18,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AddonPriceRule_pkey" PRIMARY KEY ("id")
);

-- ── New columns on existing tables ──────────────────────────────────────────

ALTER TABLE "OrganizationType" ADD COLUMN IF NOT EXISTS "defaultPriceListId" TEXT;
ALTER TABLE "OrganizationSubtype" ADD COLUMN IF NOT EXISTS "defaultPriceListId" TEXT;

-- ── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "PriceList_sortOrder_idx" ON "PriceList"("sortOrder");
CREATE INDEX IF NOT EXISTS "PriceRule_priceListId_idx" ON "PriceRule"("priceListId");
CREATE INDEX IF NOT EXISTS "PriceRule_productId_idx" ON "PriceRule"("productId");
CREATE INDEX IF NOT EXISTS "PriceRule_productVariantId_idx" ON "PriceRule"("productVariantId");
CREATE INDEX IF NOT EXISTS "PriceRule_activityTypeId_idx" ON "PriceRule"("activityTypeId");
CREATE INDEX IF NOT EXISTS "PriceRule_organizationSubtypeId_idx" ON "PriceRule"("organizationSubtypeId");
CREATE INDEX IF NOT EXISTS "Addon_sortOrder_idx" ON "Addon"("sortOrder");
CREATE INDEX IF NOT EXISTS "AddonPriceRule_addonId_idx" ON "AddonPriceRule"("addonId");
CREATE INDEX IF NOT EXISTS "AddonPriceRule_priceListId_idx" ON "AddonPriceRule"("priceListId");

-- ── Foreign keys (each added only if missing) ───────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PriceRule_priceListId_fkey') THEN
    ALTER TABLE "PriceRule" ADD CONSTRAINT "PriceRule_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PriceRule_productId_fkey') THEN
    ALTER TABLE "PriceRule" ADD CONSTRAINT "PriceRule_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PriceRule_productVariantId_fkey') THEN
    ALTER TABLE "PriceRule" ADD CONSTRAINT "PriceRule_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PriceRule_activityTypeId_fkey') THEN
    ALTER TABLE "PriceRule" ADD CONSTRAINT "PriceRule_activityTypeId_fkey" FOREIGN KEY ("activityTypeId") REFERENCES "ActivityType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PriceRule_organizationSubtypeId_fkey') THEN
    ALTER TABLE "PriceRule" ADD CONSTRAINT "PriceRule_organizationSubtypeId_fkey" FOREIGN KEY ("organizationSubtypeId") REFERENCES "OrganizationSubtype"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AddonPriceRule_addonId_fkey') THEN
    ALTER TABLE "AddonPriceRule" ADD CONSTRAINT "AddonPriceRule_addonId_fkey" FOREIGN KEY ("addonId") REFERENCES "Addon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AddonPriceRule_priceListId_fkey') THEN
    ALTER TABLE "AddonPriceRule" ADD CONSTRAINT "AddonPriceRule_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrganizationType_defaultPriceListId_fkey') THEN
    ALTER TABLE "OrganizationType" ADD CONSTRAINT "OrganizationType_defaultPriceListId_fkey" FOREIGN KEY ("defaultPriceListId") REFERENCES "PriceList"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrganizationSubtype_defaultPriceListId_fkey') THEN
    ALTER TABLE "OrganizationSubtype" ADD CONSTRAINT "OrganizationSubtype_defaultPriceListId_fkey" FOREIGN KEY ("defaultPriceListId") REFERENCES "PriceList"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ── Seed one system-default price list (idempotent) ─────────────────────────

INSERT INTO "PriceList" ("id","nameHe","nameEn","defaultVatMode","defaultVatRate","currency","isDefault","active","sortOrder","createdAt","updatedAt")
SELECT 'pricelist_system_default','מחירון ברירת מחדל','Default Price List','included',18,'ILS',true,true,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "PriceList" WHERE "isDefault" = true);
