-- "אז מה בתוכנית?" — variant-specific programme copy for the new quote section.
-- ADDITIVE, nullable only. The section TITLE lives in the Quote Template (one
-- source of truth); these two columns hold the CONTENT per Product Variant.
-- Not linked to Shared Content / Location Defaults. No data migration.
--
-- Defensive (IF NOT EXISTS) so it is safe to re-run.

ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "programHe" TEXT;
ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "programEn" TEXT;
