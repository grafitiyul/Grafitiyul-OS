-- Email module (Gmail integration). ADDITIVE only. Defensive (IF NOT EXISTS)
-- so it is safe to re-run. No existing table is dropped or rewritten.
--
--   • EmailAccount    — one connected Gmail mailbox (encrypted OAuth tokens,
--                       incremental sync cursor).
--   • EmailThread     — mirrored Gmail conversation; CRM linking lives here
--                       (contactId + linkedDealId, both SetNull FKs).
--   • EmailMessage    — one message (inbound sync or GOS-sent), sanitized HTML,
--                       idempotent on (accountId, gmailMessageId).
--   • EmailAttachment — metadata at ingest; bytes cached to private R2 on
--                       first download (r2Key set then).
--   • EmailEngagement — open-tracking counters for GOS-sent messages.

-- ── EmailAccount ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "EmailAccount" (
  "id"                   TEXT NOT NULL,
  "provider"             TEXT NOT NULL DEFAULT 'gmail',
  "emailAddress"         TEXT NOT NULL,
  "displayName"          TEXT,
  "googleAccountId"      TEXT,
  "accessTokenEnc"       TEXT,
  "accessTokenExpiresAt" TIMESTAMP(3),
  "refreshTokenEnc"      TEXT,
  "scopes"               TEXT,
  "syncStatus"           TEXT NOT NULL DEFAULT 'idle',
  "syncError"            TEXT,
  "lastSyncAt"           TIMESTAMP(3),
  "historyId"            TEXT,
  "backfillDone"         BOOLEAN NOT NULL DEFAULT false,
  "isActive"             BOOLEAN NOT NULL DEFAULT true,
  "connectedById"        TEXT,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EmailAccount_emailAddress_key"
  ON "EmailAccount"("emailAddress");
CREATE INDEX IF NOT EXISTS "EmailAccount_isActive_idx" ON "EmailAccount"("isActive");

-- ── EmailThread ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "EmailThread" (
  "id"                TEXT NOT NULL,
  "accountId"         TEXT NOT NULL,
  "gmailThreadId"     TEXT NOT NULL,
  "subject"           TEXT,
  "normalizedSubject" TEXT,
  "participants"      JSONB,
  "snippet"           TEXT,
  "lastMessageAt"     TIMESTAMP(3),
  "messageCount"      INTEGER NOT NULL DEFAULT 0,
  "unreadCount"       INTEGER NOT NULL DEFAULT 0,
  "lastReadAt"        TIMESTAMP(3),
  "contactId"         TEXT,
  "matchSource"       TEXT,
  "linkedDealId"      TEXT,
  "linkSource"        TEXT,
  "pinnedAt"          TIMESTAMP(3),
  "snoozedUntil"      TIMESTAMP(3),
  "snoozedAt"         TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailThread_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EmailThread_accountId_gmailThreadId_key"
  ON "EmailThread"("accountId", "gmailThreadId");
CREATE INDEX IF NOT EXISTS "EmailThread_accountId_lastMessageAt_idx"
  ON "EmailThread"("accountId", "lastMessageAt");
CREATE INDEX IF NOT EXISTS "EmailThread_contactId_idx" ON "EmailThread"("contactId");
CREATE INDEX IF NOT EXISTS "EmailThread_linkedDealId_idx" ON "EmailThread"("linkedDealId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'EmailThread_accountId_fkey'
  ) THEN
    ALTER TABLE "EmailThread"
      ADD CONSTRAINT "EmailThread_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "EmailAccount"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'EmailThread_contactId_fkey'
  ) THEN
    ALTER TABLE "EmailThread"
      ADD CONSTRAINT "EmailThread_contactId_fkey"
      FOREIGN KEY ("contactId") REFERENCES "Contact"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'EmailThread_linkedDealId_fkey'
  ) THEN
    ALTER TABLE "EmailThread"
      ADD CONSTRAINT "EmailThread_linkedDealId_fkey"
      FOREIGN KEY ("linkedDealId") REFERENCES "Deal"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ── EmailMessage ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "EmailMessage" (
  "id"               TEXT NOT NULL,
  "accountId"        TEXT NOT NULL,
  "threadId"         TEXT NOT NULL,
  "gmailMessageId"   TEXT NOT NULL,
  "messageIdHeader"  TEXT,
  "inReplyTo"        TEXT,
  "referencesHeader" TEXT,
  "direction"        TEXT NOT NULL,
  "fromEmail"        TEXT,
  "fromName"         TEXT,
  "toRecipients"     JSONB,
  "ccRecipients"     JSONB,
  "bccRecipients"    JSONB,
  "subject"          TEXT,
  "snippet"          TEXT,
  "bodyText"         TEXT,
  "bodyHtml"         TEXT,
  "sentAt"           TIMESTAMP(3),
  "hasAttachments"   BOOLEAN NOT NULL DEFAULT false,
  "createdByUserId"  TEXT,
  "trackingId"       TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EmailMessage_trackingId_key"
  ON "EmailMessage"("trackingId");
CREATE UNIQUE INDEX IF NOT EXISTS "EmailMessage_accountId_gmailMessageId_key"
  ON "EmailMessage"("accountId", "gmailMessageId");
CREATE INDEX IF NOT EXISTS "EmailMessage_threadId_sentAt_idx"
  ON "EmailMessage"("threadId", "sentAt");
CREATE INDEX IF NOT EXISTS "EmailMessage_accountId_sentAt_idx"
  ON "EmailMessage"("accountId", "sentAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'EmailMessage_accountId_fkey'
  ) THEN
    ALTER TABLE "EmailMessage"
      ADD CONSTRAINT "EmailMessage_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "EmailAccount"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'EmailMessage_threadId_fkey'
  ) THEN
    ALTER TABLE "EmailMessage"
      ADD CONSTRAINT "EmailMessage_threadId_fkey"
      FOREIGN KEY ("threadId") REFERENCES "EmailThread"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ── EmailAttachment ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "EmailAttachment" (
  "id"                TEXT NOT NULL,
  "messageId"         TEXT NOT NULL,
  "gmailAttachmentId" TEXT,
  "partId"            TEXT,
  "fileName"          TEXT NOT NULL,
  "mimeType"          TEXT,
  "sizeBytes"         INTEGER,
  "r2Key"             TEXT,
  "bucket"            TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EmailAttachment_messageId_idx"
  ON "EmailAttachment"("messageId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'EmailAttachment_messageId_fkey'
  ) THEN
    ALTER TABLE "EmailAttachment"
      ADD CONSTRAINT "EmailAttachment_messageId_fkey"
      FOREIGN KEY ("messageId") REFERENCES "EmailMessage"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ── EmailEngagement ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "EmailEngagement" (
  "id"            TEXT NOT NULL,
  "messageId"     TEXT NOT NULL,
  "openCount"     INTEGER NOT NULL DEFAULT 0,
  "firstOpenedAt" TIMESTAMP(3),
  "lastOpenedAt"  TIMESTAMP(3),
  "clickCount"    INTEGER NOT NULL DEFAULT 0,
  "lastClickedAt" TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailEngagement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EmailEngagement_messageId_key"
  ON "EmailEngagement"("messageId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'EmailEngagement_messageId_fkey'
  ) THEN
    ALTER TABLE "EmailEngagement"
      ADD CONSTRAINT "EmailEngagement_messageId_fkey"
      FOREIGN KEY ("messageId") REFERENCES "EmailMessage"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
