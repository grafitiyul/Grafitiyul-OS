-- iCount payment links (Deal payment module) + raw IPN audit log.
-- ADDITIVE only: two new tables, no changes to existing tables, no data
-- migration. DealPaymentLink freezes what was sent to iCount per generate
-- action (regeneration supersedes, history kept). IcountWebhookLog stores raw
-- IPN payloads for audit — no processing / no state changes in this slice.
--
-- Defensive (IF NOT EXISTS) so it is safe to re-run.

CREATE TABLE IF NOT EXISTS "DealPaymentLink" (
  "id"                  TEXT NOT NULL,
  "dealId"              TEXT NOT NULL,
  "provider"            TEXT NOT NULL DEFAULT 'icount',
  "status"              TEXT NOT NULL DEFAULT 'created',
  "paymentLinkUrl"      TEXT NOT NULL,
  "paypageId"           TEXT,
  "amountMinor"         BIGINT NOT NULL,
  "currency"            TEXT NOT NULL DEFAULT 'ILS',
  "productName"         TEXT NOT NULL,
  "customerName"        TEXT,
  "customerPhone"       TEXT,
  "customerEmail"       TEXT,
  "createdBy"           TEXT,
  "rawProviderResponse" JSONB,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DealPaymentLink_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DealPaymentLink_dealId_idx" ON "DealPaymentLink"("dealId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'DealPaymentLink_dealId_fkey'
  ) THEN
    ALTER TABLE "DealPaymentLink"
      ADD CONSTRAINT "DealPaymentLink_dealId_fkey"
      FOREIGN KEY ("dealId") REFERENCES "Deal"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "IcountWebhookLog" (
  "id"        TEXT NOT NULL,
  "dealId"    TEXT,
  "payload"   JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IcountWebhookLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "IcountWebhookLog_dealId_idx" ON "IcountWebhookLog"("dealId");
