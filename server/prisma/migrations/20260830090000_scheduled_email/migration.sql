-- Scheduled (send-later) composed emails. Same proven shape as
-- WhatsAppScheduledMessage: claim-based worker, retry ladder, cancellable,
-- connection-deferral. The composition is frozen at scheduling time and
-- replayed through the one canonical send path at delivery.
CREATE TABLE "ScheduledEmail" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "toJson" JSONB NOT NULL,
  "ccJson" JSONB,
  "bccJson" JSONB,
  "subject" TEXT,
  "bodyHtml" TEXT,
  "bodyText" TEXT,
  "attachments" JSONB,
  "replyToMessageId" TEXT,
  "forwardOfMessageId" TEXT,
  "dealId" TEXT,
  "contactId" TEXT,
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt" TIMESTAMP(3),
  "nextRetryAt" TIMESTAMP(3),
  "connectionDeferredCount" INTEGER NOT NULL DEFAULT 0,
  "claimedAt" TIMESTAMP(3),
  "claimedBy" TEXT,
  "sentAt" TIMESTAMP(3),
  "gmailMessageId" TEXT,
  "threadId" TEXT,
  "failureReason" TEXT,
  "createdById" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScheduledEmail_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ScheduledEmail_status_scheduledAt_idx" ON "ScheduledEmail"("status", "scheduledAt");
CREATE INDEX "ScheduledEmail_accountId_status_idx" ON "ScheduledEmail"("accountId", "status");
CREATE INDEX "ScheduledEmail_dealId_idx" ON "ScheduledEmail"("dealId");
CREATE INDEX "ScheduledEmail_contactId_idx" ON "ScheduledEmail"("contactId");

ALTER TABLE "ScheduledEmail" ADD CONSTRAINT "ScheduledEmail_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
