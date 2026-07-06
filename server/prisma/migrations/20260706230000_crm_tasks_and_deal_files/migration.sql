-- CRM Tasks (משימות) + Deal Files. ADDITIVE only. Defensive (IF NOT EXISTS) so
-- it is safe to re-run. No existing table is dropped or rewritten.
--
--   • TaskType  — configurable task types (CRM settings), seeded at runtime.
--   • Task      — a future action on a Deal; WhatsApp tasks link (loose) to a
--                 WhatsAppScheduledMessage. Completed/cancelled/sent/not_sent
--                 tasks surface as TimelineEntry events (existing table).
--   • DealFile  — private, R2-backed files attached to a Deal (no public URL).
--   • WhatsAppScheduledMessage.taskId — loose back-link so the send worker can
--                 move the linked Task to 'sent' the moment a send succeeds.

-- ── TaskType ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TaskType" (
  "id"                   TEXT NOT NULL,
  "key"                  TEXT NOT NULL,
  "nameHe"               TEXT NOT NULL,
  "icon"                 TEXT NOT NULL DEFAULT 'check',
  "color"                TEXT,
  "isActive"             BOOLEAN NOT NULL DEFAULT true,
  "sortOrder"            INTEGER NOT NULL DEFAULT 0,
  "defaultText"          TEXT,
  "defaultDueOffsetType" TEXT NOT NULL DEFAULT 'today',
  "defaultDueOffsetDays" INTEGER NOT NULL DEFAULT 0,
  "defaultTime"          TEXT,
  "requiresTime"         BOOLEAN NOT NULL DEFAULT false,
  "channel"              TEXT NOT NULL DEFAULT 'none',
  "isSystem"             BOOLEAN NOT NULL DEFAULT false,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaskType_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TaskType_key_key" ON "TaskType"("key");
CREATE INDEX IF NOT EXISTS "TaskType_isActive_sortOrder_idx"
  ON "TaskType"("isActive", "sortOrder");

-- ── Task ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Task" (
  "id"                      TEXT NOT NULL,
  "dealId"                  TEXT NOT NULL,
  "taskTypeId"              TEXT,
  "title"                   TEXT NOT NULL,
  "dueDate"                 TIMESTAMP(3) NOT NULL,
  "dueTime"                 TEXT,
  "priority"                TEXT,
  "ownerUserId"             TEXT NOT NULL,
  "createdByUserId"         TEXT,
  "status"                  TEXT NOT NULL DEFAULT 'open',
  "completedAt"             TIMESTAMP(3),
  "cancelledAt"             TIMESTAMP(3),
  "notes"                   TEXT,
  "channel"                 TEXT NOT NULL DEFAULT 'none',
  "scheduledMessageId"      TEXT,
  "whatsappSenderAccountId" TEXT,
  "whatsappChatId"          TEXT,
  "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"               TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Task_dealId_status_idx" ON "Task"("dealId", "status");
CREATE INDEX IF NOT EXISTS "Task_ownerUserId_status_idx" ON "Task"("ownerUserId", "status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'Task_dealId_fkey'
  ) THEN
    ALTER TABLE "Task"
      ADD CONSTRAINT "Task_dealId_fkey"
      FOREIGN KEY ("dealId") REFERENCES "Deal"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'Task_taskTypeId_fkey'
  ) THEN
    ALTER TABLE "Task"
      ADD CONSTRAINT "Task_taskTypeId_fkey"
      FOREIGN KEY ("taskTypeId") REFERENCES "TaskType"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ── DealFile ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "DealFile" (
  "id"           TEXT NOT NULL,
  "dealId"       TEXT NOT NULL,
  "r2Key"        TEXT NOT NULL,
  "bucket"       TEXT NOT NULL,
  "filename"     TEXT NOT NULL,
  "mimeType"     TEXT NOT NULL,
  "sizeBytes"    INTEGER NOT NULL,
  "uploadedById" TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DealFile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DealFile_r2Key_key" ON "DealFile"("r2Key");
CREATE INDEX IF NOT EXISTS "DealFile_dealId_createdAt_idx"
  ON "DealFile"("dealId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'DealFile_dealId_fkey'
  ) THEN
    ALTER TABLE "DealFile"
      ADD CONSTRAINT "DealFile_dealId_fkey"
      FOREIGN KEY ("dealId") REFERENCES "Deal"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ── WhatsAppScheduledMessage.taskId (loose back-link, no FK) ─────────────────
ALTER TABLE "WhatsAppScheduledMessage" ADD COLUMN IF NOT EXISTS "taskId" TEXT;
CREATE INDEX IF NOT EXISTS "WhatsAppScheduledMessage_taskId_idx"
  ON "WhatsAppScheduledMessage"("taskId");
