-- Which business number the automatic new-lead reply sends from.
--
-- Additive only: a nullable column plus a backfill. Null means "never chosen"
-- and resolves to the default ('main' / מכירות) at send time, so existing rows
-- behave correctly even without the backfill below.
ALTER TABLE "WhatsAppTemplate"
  ADD COLUMN "newLeadSendAccountId" TEXT;

-- Backfill the template that currently holds the star to מכירות, so the
-- operator sees an explicit selection in the dropdown rather than an empty one.
-- Scoped to the starred row: a template nobody starred has nothing to choose.
UPDATE "WhatsAppTemplate"
   SET "newLeadSendAccountId" = 'main'
 WHERE "isNewLeadDefault" = true
   AND "newLeadSendAccountId" IS NULL;
