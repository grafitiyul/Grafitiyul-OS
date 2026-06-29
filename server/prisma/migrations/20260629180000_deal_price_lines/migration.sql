-- Deal: Price Builder lines (JSON). ADDITIVE, nullable only.
--
-- Holds the deal's base-pricing line items as a JSON array (the Price Builder's
-- source of truth); valueMinor stays the computed total summary. No quote model
-- yet — this is the same line shape a future QuoteLine will use, so it can later
-- move under a QuoteVersion without a builder rewrite. No data migration.
--
-- Defensive (IF NOT EXISTS) so it is safe to re-run.

ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "priceLines" JSONB;
