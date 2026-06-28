-- Deal: "פרטי הסיור" working fields for the sales-call workspace.
--
-- ADDITIVE ONLY. Seven new nullable columns on "Deal". Nothing is dropped; no
-- catalogs, no FKs, no quote/pricing logic. Each is a simple Deal scalar (single
-- source of truth = the Deal itself). String enums are validated at the API
-- (project convention — no Postgres enums).
--
--   • "tourDate"              — the tour date as "YYYY-MM-DD" (no TZ ambiguity).
--   • "tourTime"              — the tour time as "HH:MM".
--   • "participants"          — head count (integer).
--   • "paymentMethod"         — card | transfer | cash | check | other.
--   • "communicationLanguage" — he | en.
--   • "tourLanguage"          — he | en | es | fr | ru.
--   • "customerInfo"          — internal working note (lightweight rich HTML).
--
-- Written defensively (IF NOT EXISTS) so it is safe to re-run.

ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "tourDate" TEXT;
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "tourTime" TEXT;
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "participants" INTEGER;
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT;
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "communicationLanguage" TEXT;
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "tourLanguage" TEXT;
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "customerInfo" TEXT;
