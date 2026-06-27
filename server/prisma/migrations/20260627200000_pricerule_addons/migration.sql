-- Pricing card add-ons — per-card add-on configuration.
--
-- ADDITIVE ONLY. One new table (PriceRuleAddon: card×addon price/VAT/auto-apply),
-- its indexes and FKs. The Addon catalog and AddonPriceRule are untouched. No
-- engine, Deals, Quotes, or payments changes. Defensive (IF NOT EXISTS + guarded
-- constraints) so it is safe to re-run.

CREATE TABLE IF NOT EXISTS "PriceRuleAddon" (
    "id" TEXT NOT NULL,
    "priceRuleId" TEXT NOT NULL,
    "addonId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priceMinor" BIGINT NOT NULL DEFAULT 0,
    "vatMode" TEXT,
    "vatRate" INTEGER,
    "autoApply" TEXT NOT NULL DEFAULT 'manual',
    "autoApplyWeekdays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceRuleAddon_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PriceRuleAddon_priceRuleId_addonId_key" ON "PriceRuleAddon"("priceRuleId", "addonId");
CREATE INDEX IF NOT EXISTS "PriceRuleAddon_priceRuleId_idx" ON "PriceRuleAddon"("priceRuleId");
CREATE INDEX IF NOT EXISTS "PriceRuleAddon_addonId_idx" ON "PriceRuleAddon"("addonId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PriceRuleAddon_priceRuleId_fkey') THEN
    ALTER TABLE "PriceRuleAddon" ADD CONSTRAINT "PriceRuleAddon_priceRuleId_fkey" FOREIGN KEY ("priceRuleId") REFERENCES "PriceRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PriceRuleAddon_addonId_fkey') THEN
    ALTER TABLE "PriceRuleAddon" ADD CONSTRAINT "PriceRuleAddon_addonId_fkey" FOREIGN KEY ("addonId") REFERENCES "Addon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
