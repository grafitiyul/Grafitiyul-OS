-- WhatsApp module Slices 6-7 — outbound send + scheduled messages.
-- ADDITIVE only. Both tables carry a direct accountId (purge/query contract).
-- Defensive (IF NOT EXISTS) so it is safe to re-run.

-- Slice 6: proto-encoded outbound payload for WhatsApp retransmit replay
-- (getMessage). Null on inbound rows.
ALTER TABLE "WhatsAppMessage" ADD COLUMN IF NOT EXISTS "outboundPayload" BYTEA;

-- Slice 6: outbound send idempotency — a retried send replays the recorded
-- outcome instead of double-messaging a customer.
CREATE TABLE IF NOT EXISTS "WhatsAppOutboundIdempotency" (
  "key"               TEXT NOT NULL,
  "accountId"         TEXT NOT NULL,
  "outcome"           TEXT NOT NULL,
  "externalMessageId" TEXT,
  "errorCode"         TEXT,
  "errorMessage"      TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsAppOutboundIdempotency_pkey" PRIMARY KEY ("key")
);

CREATE INDEX IF NOT EXISTS "WhatsAppOutboundIdempotency_accountId_idx"
  ON "WhatsAppOutboundIdempotency"("accountId");
CREATE INDEX IF NOT EXISTS "WhatsAppOutboundIdempotency_createdAt_idx"
  ON "WhatsAppOutboundIdempotency"("createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'WhatsAppOutboundIdempotency_accountId_fkey'
  ) THEN
    ALTER TABLE "WhatsAppOutboundIdempotency"
      ADD CONSTRAINT "WhatsAppOutboundIdempotency_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "WhatsAppAccount"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Slice 7: scheduled outbound messages (text-only V1), claim-based worker in
-- the GOS server. claimedAt/claimedBy + status form the atomic-claim lock.
CREATE TABLE IF NOT EXISTS "WhatsAppScheduledMessage" (
  "id"                      TEXT NOT NULL,
  "accountId"               TEXT NOT NULL,
  "chatId"                  TEXT NOT NULL,
  "content"                 TEXT NOT NULL,
  "scheduledAt"             TIMESTAMP(3) NOT NULL,
  "status"                  TEXT NOT NULL DEFAULT 'pending',
  "attemptCount"            INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt"           TIMESTAMP(3),
  "nextRetryAt"             TIMESTAMP(3),
  "connectionDeferredCount" INTEGER NOT NULL DEFAULT 0,
  "claimedAt"               TIMESTAMP(3),
  "claimedBy"               TEXT,
  "sentAt"                  TIMESTAMP(3),
  "externalMessageId"       TEXT,
  "failureReason"           TEXT,
  "createdById"             TEXT,
  "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"               TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WhatsAppScheduledMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "WhatsAppScheduledMessage_status_scheduledAt_idx"
  ON "WhatsAppScheduledMessage"("status", "scheduledAt");
CREATE INDEX IF NOT EXISTS "WhatsAppScheduledMessage_accountId_status_idx"
  ON "WhatsAppScheduledMessage"("accountId", "status");
CREATE INDEX IF NOT EXISTS "WhatsAppScheduledMessage_chatId_status_idx"
  ON "WhatsAppScheduledMessage"("chatId", "status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'WhatsAppScheduledMessage_accountId_fkey'
  ) THEN
    ALTER TABLE "WhatsAppScheduledMessage"
      ADD CONSTRAINT "WhatsAppScheduledMessage_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "WhatsAppAccount"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'WhatsAppScheduledMessage_chatId_fkey'
  ) THEN
    ALTER TABLE "WhatsAppScheduledMessage"
      ADD CONSTRAINT "WhatsAppScheduledMessage_chatId_fkey"
      FOREIGN KEY ("chatId") REFERENCES "WhatsAppChat"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
