-- Pricing cards — configurable note for the first generated builder line.
--
-- ADDITIVE ONLY. One new nullable TEXT column on PriceRule. It holds the rich-text
-- note the pricing engine writes onto the FIRST builder line produced by this
-- card during automatic calculation (empty/null = no automatic note). Duplicated
-- across a card's sibling rules like cardSortOrder; the engine's rule RESOLUTION
-- never reads it. Idempotent.

ALTER TABLE "PriceRule" ADD COLUMN IF NOT EXISTS "firstLineNote" TEXT;
