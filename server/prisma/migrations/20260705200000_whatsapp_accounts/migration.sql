-- WhatsApp module Slice 1 — sender accounts + Baileys session store + data-gap
-- ledger. ADDITIVE only: three new tables, no changes to existing tables.
-- One bridge service per WhatsApp number writes here; everything is scoped by
-- accountId (no singleton assumptions).
--
-- Defensive (IF NOT EXISTS) so it is safe to re-run.

CREATE TABLE IF NOT EXISTS "WhatsAppAccount" (
  "id"                   TEXT NOT NULL,
  "label"                TEXT NOT NULL,
  "active"               BOOLEAN NOT NULL DEFAULT true,
  "sortOrder"            INTEGER NOT NULL DEFAULT 0,
  "status"               TEXT NOT NULL DEFAULT 'disconnected',
  "qr"                   TEXT,
  "phoneJid"             TEXT,
  "deviceName"           TEXT,
  "lastQrAt"             TIMESTAMP(3),
  "lastConnectedAt"      TIMESTAMP(3),
  "lastDisconnectAt"     TIMESTAMP(3),
  "lastDisconnectReason" TEXT,
  "lastMessageAt"        TIMESTAMP(3),
  "lastInboundMessageAt" TIMESTAMP(3),
  "reconnectAttempts"    INTEGER NOT NULL DEFAULT 0,
  "lastMediaError"       TEXT,
  "lastMediaErrorAt"     TIMESTAMP(3),
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WhatsAppAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WhatsAppSession" (
  "id"        TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "kind"      TEXT NOT NULL,
  "keyId"     TEXT NOT NULL,
  "data"      JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WhatsAppSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppSession_accountId_kind_keyId_key"
  ON "WhatsAppSession"("accountId", "kind", "keyId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'WhatsAppSession_accountId_fkey'
  ) THEN
    ALTER TABLE "WhatsAppSession"
      ADD CONSTRAINT "WhatsAppSession_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "WhatsAppAccount"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "WhatsAppDataGap" (
  "id"               TEXT NOT NULL,
  "accountId"        TEXT NOT NULL,
  "disconnectedAt"   TIMESTAMP(3) NOT NULL,
  "reconnectedAt"    TIMESTAMP(3),
  "durationMs"       INTEGER,
  "disconnectReason" TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsAppDataGap_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "WhatsAppDataGap_accountId_reconnectedAt_idx"
  ON "WhatsAppDataGap"("accountId", "reconnectedAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'WhatsAppDataGap_accountId_fkey'
  ) THEN
    ALTER TABLE "WhatsAppDataGap"
      ADD CONSTRAINT "WhatsAppDataGap_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "WhatsAppAccount"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
