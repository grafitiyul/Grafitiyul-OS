-- Pricing — 4th model: Ticket Price (ticket_types).
--
-- ADDITIVE ONLY. Two new tables (TicketType catalog + PriceRuleTicketPrice join),
-- their indexes/FKs, and two seed ticket types (Adult/Child) as editable examples.
-- No existing table, column, or constraint changes; priceModel simply gains the
-- new 'ticket_types' string value (no DDL). Defensive (IF NOT EXISTS + guarded
-- constraints) so it is safe to re-run.

-- ── New tables ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "TicketType" (
    "id" TEXT NOT NULL,
    "nameHe" TEXT NOT NULL,
    "nameEn" TEXT,
    "descriptionHe" TEXT,
    "descriptionEn" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketType_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PriceRuleTicketPrice" (
    "id" TEXT NOT NULL,
    "priceRuleId" TEXT NOT NULL,
    "ticketTypeId" TEXT NOT NULL,
    "priceMinor" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceRuleTicketPrice_pkey" PRIMARY KEY ("id")
);

-- ── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "TicketType_sortOrder_idx" ON "TicketType"("sortOrder");
CREATE UNIQUE INDEX IF NOT EXISTS "PriceRuleTicketPrice_priceRuleId_ticketTypeId_key" ON "PriceRuleTicketPrice"("priceRuleId", "ticketTypeId");
CREATE INDEX IF NOT EXISTS "PriceRuleTicketPrice_priceRuleId_idx" ON "PriceRuleTicketPrice"("priceRuleId");
CREATE INDEX IF NOT EXISTS "PriceRuleTicketPrice_ticketTypeId_idx" ON "PriceRuleTicketPrice"("ticketTypeId");

-- ── Foreign keys (each added only if missing) ───────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PriceRuleTicketPrice_priceRuleId_fkey') THEN
    ALTER TABLE "PriceRuleTicketPrice" ADD CONSTRAINT "PriceRuleTicketPrice_priceRuleId_fkey" FOREIGN KEY ("priceRuleId") REFERENCES "PriceRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PriceRuleTicketPrice_ticketTypeId_fkey') THEN
    ALTER TABLE "PriceRuleTicketPrice" ADD CONSTRAINT "PriceRuleTicketPrice_ticketTypeId_fkey" FOREIGN KEY ("ticketTypeId") REFERENCES "TicketType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ── Seed example ticket types (idempotent by id) ────────────────────────────
-- Editable from the admin UI; adult/child are examples, not hard-coded.

INSERT INTO "TicketType" ("id","nameHe","nameEn","active","sortOrder","createdAt","updatedAt")
SELECT 'tickettype_adult','מבוגר','Adult',true,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "TicketType" WHERE "id" = 'tickettype_adult');

INSERT INTO "TicketType" ("id","nameHe","nameEn","active","sortOrder","createdAt","updatedAt")
SELECT 'tickettype_child','ילד','Child',true,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "TicketType" WHERE "id" = 'tickettype_child');
