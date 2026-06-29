-- Location: "Home Location" business setting. ADDITIVE + defaulted false. At most
-- one row is true — enforced at the API (setting one unsets the previous), like
-- PriceList.isDefault. Visual-only reminder on the Deal panel; no pricing/workflow
-- impact. Safe to re-run.

ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "isHomeLocation" BOOLEAN NOT NULL DEFAULT false;
