-- Staff WhatsApp send: chatless destinations + per-recipient batch rows on the
-- canonical scheduled-message queue, plus outbound attachment refs.

-- AlterTable: WhatsAppScheduledMessage
ALTER TABLE "WhatsAppScheduledMessage" ALTER COLUMN "chatId" DROP NOT NULL;
ALTER TABLE "WhatsAppScheduledMessage" ADD COLUMN "destinationJid" TEXT;
ALTER TABLE "WhatsAppScheduledMessage" ADD COLUMN "destinationPhone" TEXT;
ALTER TABLE "WhatsAppScheduledMessage" ADD COLUMN "personRefId" TEXT;
ALTER TABLE "WhatsAppScheduledMessage" ADD COLUMN "batchId" TEXT;
ALTER TABLE "WhatsAppScheduledMessage" ADD COLUMN "attachments" JSONB;

-- CreateIndex
CREATE INDEX "WhatsAppScheduledMessage_batchId_idx" ON "WhatsAppScheduledMessage"("batchId");
CREATE INDEX "WhatsAppScheduledMessage_personRefId_idx" ON "WhatsAppScheduledMessage"("personRefId");

-- CreateTable: WhatsAppSendBatch
CREATE TABLE "WhatsAppSendBatch" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'staff',
    "templateHtml" TEXT NOT NULL,
    "templateText" TEXT NOT NULL,
    "attachments" JSONB,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "sendNow" BOOLEAN NOT NULL DEFAULT false,
    "recipientCount" INTEGER NOT NULL,
    "skipped" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppSendBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppSendBatch_idempotencyKey_key" ON "WhatsAppSendBatch"("idempotencyKey");
CREATE INDEX "WhatsAppSendBatch_createdAt_idx" ON "WhatsAppSendBatch"("createdAt");
