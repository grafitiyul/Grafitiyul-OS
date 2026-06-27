-- שבת/חג surcharge as a SYSTEM add-on inherited by every Pricing Card.
--
-- ADDITIVE / RELAXING ONLY. Adds Addon.systemKey (stable identifier), relaxes
-- PriceRuleAddon.priceMinor to nullable (null = inherit the catalog default), and
-- seeds one system Addon (systemKey='sabbath_holiday'). No data loss; existing
-- add-on rows keep their prices. No pricing/Deals/Quotes changes. Idempotent.

ALTER TABLE "Addon" ADD COLUMN IF NOT EXISTS "systemKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Addon_systemKey_key" ON "Addon"("systemKey");

-- Per-field inheritance: null price = inherit the catalog default.
ALTER TABLE "PriceRuleAddon" ALTER COLUMN "priceMinor" DROP NOT NULL;
ALTER TABLE "PriceRuleAddon" ALTER COLUMN "priceMinor" DROP DEFAULT;

-- Seed the system שבת/חג surcharge (price 0 until the owner sets the catalog
-- default; a 0 surcharge renders no line). Identified by systemKey, never name.
INSERT INTO "Addon"
  ("id","nameHe","nameEn","systemKey","defaultPriceMinor","currency","vatMode","vatRate","defaultQuantity","active","sortOrder","createdAt","updatedAt")
SELECT 'addon_sabbath_holiday','תוספת שבת/חג','Sabbath/Holiday surcharge','sabbath_holiday',0,'ILS','included',18,1,true,1000,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Addon" WHERE "systemKey" = 'sabbath_holiday');
