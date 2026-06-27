-- Pricing cards — manual ordering within a tab.
--
-- ADDITIVE ONLY. One new nullable-with-default column on PriceRule. It is the
-- business display order of a CARD (shared across the card's sibling rules); the
-- engine never reads it (resolution still uses `priority`). Existing rows default
-- to 0, preserving current behavior. Idempotent.

ALTER TABLE "PriceRule" ADD COLUMN IF NOT EXISTS "cardSortOrder" INTEGER NOT NULL DEFAULT 0;
