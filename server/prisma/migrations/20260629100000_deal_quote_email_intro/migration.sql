-- Deal: "פתיח אישי למייל" — the personal email introduction for the commercial
-- (Quote) card. ADDITIVE, nullable only. No catalogs, no FKs, no data migration.
--
-- Temporary home: it lives on Deal for now. When the QuoteVersion model lands,
-- the intro becomes per-quote (with an optional Deal-level default) and the value
-- moves there. Storing it here now lets the commercial card persist the field
-- without standing up the quote architecture.
--
-- Defensive (IF NOT EXISTS) so it is safe to re-run.

ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "quoteEmailIntro" TEXT;
