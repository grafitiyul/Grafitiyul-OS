-- Remove the "Personal Introduction" (פתיח אישי) quote section entirely.
-- The redesigned Hero already introduces the proposal, so this per-quote intro is
-- retired. QuoteDocument.personalIntro was its ONLY storage; drop it.
--
-- Safe: produced/frozen quotes read renderModelSnapshot (never this column), so
-- existing frozen quotes are unaffected. Draft intro text is intentionally
-- discarded with the feature. Deal.quoteEmailIntro is a separate Deal field and
-- is left untouched. Defensive (IF EXISTS) so it is safe to re-run.

ALTER TABLE "QuoteDocument" DROP COLUMN IF EXISTS "personalIntro";
