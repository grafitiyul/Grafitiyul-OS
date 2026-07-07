-- iCount document production + custom payment links (Deal accounting slice).
-- ADDITIVE only: two new tables, no changes to existing tables, no data
-- migration. IcountDocument records every accounting document GOS issued (or
-- captured from a webhook) for a deal; idempotencyKey is UNIQUE so a retried
-- submit/webhook can never create a duplicate. DealCustomPaymentLink is a
-- frozen custom-description/amount payment link served via /pay/c/<token>.
--
-- Defensive (IF NOT EXISTS) so it is safe to re-run.

CREATE TABLE IF NOT EXISTS "IcountDocument" (
  "id"             TEXT NOT NULL,
  "dealId"         TEXT NOT NULL,
  "provider"       TEXT NOT NULL DEFAULT 'icount',
  "source"         TEXT NOT NULL DEFAULT 'user',
  "doctype"        TEXT NOT NULL,
  "docnum"         TEXT,
  "providerDocId"  TEXT,
  "status"         TEXT NOT NULL DEFAULT 'issued',
  "amountMinor"    BIGINT NOT NULL,
  "currency"       TEXT NOT NULL DEFAULT 'ILS',
  "clientName"     TEXT NOT NULL,
  "clientVatId"    TEXT,
  "docUrl"         TEXT,
  "basedOnDoctype" TEXT,
  "basedOnDocnum"  TEXT,
  "idempotencyKey" TEXT,
  "issuedBy"       TEXT,
  "raw"            JSONB,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IcountDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "IcountDocument_dealId_idx" ON "IcountDocument"("dealId");
CREATE UNIQUE INDEX IF NOT EXISTS "IcountDocument_idempotencyKey_key" ON "IcountDocument"("idempotencyKey");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'IcountDocument_dealId_fkey'
  ) THEN
    ALTER TABLE "IcountDocument"
      ADD CONSTRAINT "IcountDocument_dealId_fkey"
      FOREIGN KEY ("dealId") REFERENCES "Deal"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "DealCustomPaymentLink" (
  "id"                  TEXT NOT NULL,
  "dealId"              TEXT NOT NULL,
  "token"               TEXT NOT NULL,
  "status"              TEXT NOT NULL DEFAULT 'active',
  "description"         TEXT NOT NULL,
  "amountMinor"         BIGINT NOT NULL,
  "currency"            TEXT NOT NULL DEFAULT 'ILS',
  "notes"               TEXT,
  "paymentLinkUrl"      TEXT,
  "rawProviderResponse" JSONB,
  "createdBy"           TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DealCustomPaymentLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DealCustomPaymentLink_token_key" ON "DealCustomPaymentLink"("token");
CREATE INDEX IF NOT EXISTS "DealCustomPaymentLink_dealId_idx" ON "DealCustomPaymentLink"("dealId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'DealCustomPaymentLink_dealId_fkey'
  ) THEN
    ALTER TABLE "DealCustomPaymentLink"
      ADD CONSTRAINT "DealCustomPaymentLink_dealId_fkey"
      FOREIGN KEY ("dealId") REFERENCES "Deal"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
