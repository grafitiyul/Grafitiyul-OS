-- Cardcom tourist payment requests (separate clearing provider) + webhook log.
-- ADDITIVE only: two new tables, no changes to existing tables, no data
-- migration. PaymentRequest is a payment INTENT with its own lifecycle
-- (pending → paid | canceled); GOS is the source of truth, Cardcom only clears
-- (3DS tourist cards), iCount stays the accounting provider.
--
-- BUSINESS INVARIANT: at most ONE pending cardcom PaymentRequest per deal —
-- enforced by a PARTIAL UNIQUE INDEX (dealId WHERE status='pending' AND
-- provider='cardcom'), concurrency-safe (a second concurrent create hits the
-- unique violation and the app reopens the existing pending request instead).
--
-- Defensive (IF NOT EXISTS) so it is safe to re-run.

CREATE TABLE IF NOT EXISTS "PaymentRequest" (
  "id"                   TEXT NOT NULL,
  "dealId"               TEXT NOT NULL,
  "provider"             TEXT NOT NULL DEFAULT 'cardcom',
  "status"               TEXT NOT NULL DEFAULT 'pending',
  "token"                TEXT NOT NULL,
  "currency"             TEXT NOT NULL DEFAULT 'ILS',
  "amountMinor"          BIGINT NOT NULL,
  "quantity"             INTEGER NOT NULL DEFAULT 1,
  "productDescriptionEn" TEXT NOT NULL,
  "customerName"         TEXT,
  "customerEmail"        TEXT,
  "customerPhone"        TEXT,
  "vatExempt"            BOOLEAN NOT NULL DEFAULT false,
  "productId"            TEXT,
  "productVariantId"     TEXT,
  "quoteVersionId"       TEXT,
  "cardcomLowProfileId"  TEXT,
  "cardcomPayUrl"        TEXT,
  "snapshotHash"         TEXT,
  "paidAt"               TIMESTAMP(3),
  "cardcomTransactionId" TEXT,
  "paidRaw"              JSONB,
  "docStatus"            TEXT NOT NULL DEFAULT 'none',
  "icountDocumentId"     TEXT,
  "createdBy"            TEXT,
  "rawProviderResponse"  JSONB,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentRequest_token_key" ON "PaymentRequest"("token");
CREATE INDEX IF NOT EXISTS "PaymentRequest_dealId_idx" ON "PaymentRequest"("dealId");
CREATE INDEX IF NOT EXISTS "PaymentRequest_dealId_status_idx" ON "PaymentRequest"("dealId", "status");

-- One active (pending) cardcom request per deal — the concurrency-safe invariant.
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentRequest_one_pending_cardcom_per_deal"
  ON "PaymentRequest"("dealId")
  WHERE "status" = 'pending' AND "provider" = 'cardcom';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'PaymentRequest_dealId_fkey'
  ) THEN
    ALTER TABLE "PaymentRequest"
      ADD CONSTRAINT "PaymentRequest_dealId_fkey"
      FOREIGN KEY ("dealId") REFERENCES "Deal"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "CardcomWebhookLog" (
  "id"        TEXT NOT NULL,
  "token"     TEXT,
  "payload"   JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CardcomWebhookLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CardcomWebhookLog_token_idx" ON "CardcomWebhookLog"("token");
