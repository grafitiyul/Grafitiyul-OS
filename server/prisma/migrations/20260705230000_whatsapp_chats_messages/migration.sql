-- WhatsApp module Slice 2 — chat mirror storage: chats, messages, reactions.
-- ADDITIVE only. Every table carries a direct accountId (purge/query
-- contract); chats are unique per (accountId, externalChatId) — the same
-- customer can have a separate thread with each of our numbers.
--
-- Defensive (IF NOT EXISTS) so it is safe to re-run.

CREATE TABLE IF NOT EXISTS "WhatsAppChat" (
  "id"                TEXT NOT NULL,
  "accountId"         TEXT NOT NULL,
  "externalChatId"    TEXT NOT NULL,
  "type"              TEXT NOT NULL,
  "savedContactName"  TEXT,
  "pushName"          TEXT,
  "groupSubject"      TEXT,
  "phoneNumber"       TEXT,
  "lidJid"            TEXT,
  "phoneJid"          TEXT,
  "profilePictureUrl" TEXT,
  "contactId"         TEXT,
  "matchSource"       TEXT,
  "lastMessageAt"     TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WhatsAppChat_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppChat_accountId_externalChatId_key"
  ON "WhatsAppChat"("accountId", "externalChatId");
CREATE INDEX IF NOT EXISTS "WhatsAppChat_accountId_lastMessageAt_idx"
  ON "WhatsAppChat"("accountId", "lastMessageAt");
CREATE INDEX IF NOT EXISTS "WhatsAppChat_accountId_phoneNumber_idx"
  ON "WhatsAppChat"("accountId", "phoneNumber");
CREATE INDEX IF NOT EXISTS "WhatsAppChat_accountId_lidJid_idx"
  ON "WhatsAppChat"("accountId", "lidJid");
CREATE INDEX IF NOT EXISTS "WhatsAppChat_accountId_phoneJid_idx"
  ON "WhatsAppChat"("accountId", "phoneJid");
CREATE INDEX IF NOT EXISTS "WhatsAppChat_contactId_idx"
  ON "WhatsAppChat"("contactId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'WhatsAppChat_accountId_fkey'
  ) THEN
    ALTER TABLE "WhatsAppChat"
      ADD CONSTRAINT "WhatsAppChat_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "WhatsAppAccount"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'WhatsAppChat_contactId_fkey'
  ) THEN
    ALTER TABLE "WhatsAppChat"
      ADD CONSTRAINT "WhatsAppChat_contactId_fkey"
      FOREIGN KEY ("contactId") REFERENCES "Contact"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "WhatsAppMessage" (
  "id"                  TEXT NOT NULL,
  "accountId"           TEXT NOT NULL,
  "chatId"              TEXT NOT NULL,
  "externalMessageId"   TEXT,
  "direction"           TEXT,
  "senderName"          TEXT,
  "senderPhone"         TEXT,
  "messageType"         TEXT NOT NULL,
  "textContent"         TEXT,
  "mediaKey"            TEXT,
  "mediaStatus"         TEXT,
  "mediaMimeType"       TEXT,
  "mediaSizeBytes"      INTEGER,
  "mediaOriginalName"   TEXT,
  "mediaThumbBase64"    TEXT,
  "quotedExternalId"    TEXT,
  "rawPayload"          JSONB,
  "timestampFromSource" TIMESTAMP(3) NOT NULL,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppMessage_accountId_externalMessageId_key"
  ON "WhatsAppMessage"("accountId", "externalMessageId");
CREATE INDEX IF NOT EXISTS "WhatsAppMessage_chatId_timestampFromSource_idx"
  ON "WhatsAppMessage"("chatId", "timestampFromSource");
CREATE INDEX IF NOT EXISTS "WhatsAppMessage_accountId_createdAt_idx"
  ON "WhatsAppMessage"("accountId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'WhatsAppMessage_accountId_fkey'
  ) THEN
    ALTER TABLE "WhatsAppMessage"
      ADD CONSTRAINT "WhatsAppMessage_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "WhatsAppAccount"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'WhatsAppMessage_chatId_fkey'
  ) THEN
    ALTER TABLE "WhatsAppMessage"
      ADD CONSTRAINT "WhatsAppMessage_chatId_fkey"
      FOREIGN KEY ("chatId") REFERENCES "WhatsAppChat"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "WhatsAppMessageReaction" (
  "id"                TEXT NOT NULL,
  "accountId"         TEXT NOT NULL,
  "externalMessageId" TEXT NOT NULL,
  "reactorPhone"      TEXT NOT NULL,
  "reactorName"       TEXT,
  "emoji"             TEXT NOT NULL,
  "reactedAt"         TIMESTAMP(3) NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsAppMessageReaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppMessageReaction_accountId_externalMessageId_reactorPhone_key"
  ON "WhatsAppMessageReaction"("accountId", "externalMessageId", "reactorPhone");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'WhatsAppMessageReaction_accountId_fkey'
  ) THEN
    ALTER TABLE "WhatsAppMessageReaction"
      ADD CONSTRAINT "WhatsAppMessageReaction_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "WhatsAppAccount"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
