-- Pricing polish: second note template per Pricing Card.
--
-- ADDITIVE ONLY. One nullable TEXT column. `multiGroupNote` is the rich-text
-- note template used when the calculation runs with groups > 1 (empty/null →
-- fall back to firstLineNote). Both templates support {{variable}}
-- placeholders rendered by the engine at regeneration time. Duplicated across
-- a card's sibling rules like firstLineNote. Idempotent.

ALTER TABLE "PriceRule" ADD COLUMN IF NOT EXISTS "multiGroupNote" TEXT;
