-- QuoteLine: structured identity for Group Ticket Builder lines. ADDITIVE + nullable
-- so regular builder lines are untouched. Replaces the (rejected) note-as-identity:
-- `note` stays USER content; identity now lives in explicit columns. A group-ticket
-- line is one ticket type from one Pricing Card → (sourceCardGroupId, ticketTypeId).
-- sourceCardGroupId is a loose key (no CardGroup table); ticketTypeId is a real FK
-- with ON DELETE SET NULL so catalog deletes degrade gracefully. Safe to re-run.

ALTER TABLE "QuoteLine" ADD COLUMN IF NOT EXISTS "sourceKind" TEXT;
ALTER TABLE "QuoteLine" ADD COLUMN IF NOT EXISTS "sourceCardGroupId" TEXT;
ALTER TABLE "QuoteLine" ADD COLUMN IF NOT EXISTS "ticketTypeId" TEXT;

CREATE INDEX IF NOT EXISTS "QuoteLine_ticketTypeId_idx" ON "QuoteLine"("ticketTypeId");

DO $$ BEGIN
  ALTER TABLE "QuoteLine"
    ADD CONSTRAINT "QuoteLine_ticketTypeId_fkey"
    FOREIGN KEY ("ticketTypeId") REFERENCES "TicketType"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
