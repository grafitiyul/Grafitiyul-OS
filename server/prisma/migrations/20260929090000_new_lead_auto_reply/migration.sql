-- New Lead Auto Reply — the starred WhatsApp template + the attempt ledger.

-- 1. The star. At most ONE template may be the new-lead default.
ALTER TABLE "WhatsAppTemplate"
  ADD COLUMN "isNewLeadDefault" BOOLEAN NOT NULL DEFAULT false;

-- The invariant lives in the DATABASE, not only in application code: a PARTIAL
-- unique index over the true rows. Zero starred rows stays valid (no row to
-- conflict); a second star raises a unique violation the API turns into a clear
-- error rather than silently ending up with two automatic replies.
CREATE UNIQUE INDEX "WhatsAppTemplate_newLeadDefault_key"
  ON "WhatsAppTemplate" ("isNewLeadDefault")
  WHERE "isNewLeadDefault" = true;

-- 2. The attempt ledger. One row per attempted automatic reply, including every
-- deliberate skip. `idempotencyKey` is the exactly-once gate.
CREATE TABLE "NewLeadAutoReply" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "origin" TEXT,
  "ingressEventId" TEXT,
  "dealId" TEXT,
  "contactId" TEXT,
  "phoneIntl" TEXT,
  "language" TEXT,
  "templateId" TEXT,
  "templateName" TEXT,
  "renderedText" TEXT,
  "accountId" TEXT,
  "scheduledMessageId" TEXT,
  "status" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "NewLeadAutoReply_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NewLeadAutoReply_idempotencyKey_key"
  ON "NewLeadAutoReply" ("idempotencyKey");
CREATE INDEX "NewLeadAutoReply_dealId_idx" ON "NewLeadAutoReply" ("dealId");
CREATE INDEX "NewLeadAutoReply_status_createdAt_idx"
  ON "NewLeadAutoReply" ("status", "createdAt");
CREATE INDEX "NewLeadAutoReply_createdAt_idx" ON "NewLeadAutoReply" ("createdAt");
