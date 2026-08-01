-- THE order-level VAT mode moves onto the QuoteVersion, where it belongs.
--
-- Until now nothing stored "this quote is priced לפני מע״מ". The Builder
-- inferred it for display from the first line carrying an explicit vatMode, and
-- the picker stamped that mode onto every existing line. A line added later was
-- born 'inherit', which resolved to the PriceList default ('included'), so a
-- quote configured "לפני מע״מ" read the next typed amount as VAT-INCLUSIVE.
--
-- Backfill is deterministic and cannot change a single total: a version adopts
-- a mode ONLY when every explicit line mode it holds agrees, and explicit line
-- modes keep winning over the order mode in the resolver either way. Versions
-- with no explicit mode, or with disagreeing ones, stay NULL and continue to
-- fall back to the PriceList default exactly as before.
ALTER TABLE "QuoteVersion" ADD COLUMN "vatMode" TEXT;

UPDATE "QuoteVersion" v
SET "vatMode" = agreed.mode
FROM (
  SELECT l."quoteVersionId" AS version_id, MIN(l."vatMode") AS mode
  FROM "QuoteLine" l
  WHERE l."active" = true
    AND l."vatMode" IS NOT NULL
    AND l."vatMode" <> 'inherit'
  GROUP BY l."quoteVersionId"
  HAVING COUNT(DISTINCT l."vatMode") = 1
) AS agreed
WHERE v."id" = agreed.version_id;
