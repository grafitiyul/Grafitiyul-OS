-- The COMPOSER default: which template a composer opens with, per audience.
--
-- Deliberately NOT the existing isNewLeadDefault star, which answers a
-- different question ("which template is sent automatically to a new lead").
-- Nothing is ever sent because of this flag — an operator still writes and
-- presses send. One column per fact.
ALTER TABLE "WhatsAppTemplate"
  ADD COLUMN "isAudienceDefault" BOOLEAN NOT NULL DEFAULT false;

-- Which of OUR numbers this template is normally sent from, for MANUAL sends.
-- Nullable: null means "never chosen" and resolves at compose time to the
-- audience's documented default, so existing rows behave correctly with no
-- backfill at all.
ALTER TABLE "WhatsAppTemplate"
  ADD COLUMN "sendAccountId" TEXT;

-- "At most one default PER AUDIENCE" is an invariant, not a convention a
-- future code path may forget — so the database holds it. A partial unique
-- index over (audience) restricted to the flagged rows: the guide composer and
-- the customer composer each get at most one, and they never compete.
CREATE UNIQUE INDEX "WhatsAppTemplate_audience_default_unique"
  ON "WhatsAppTemplate" ("audience")
  WHERE "isAudienceDefault" = true;
