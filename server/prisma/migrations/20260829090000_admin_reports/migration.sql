-- Admin Reports ("דיווחי מנהלים") — code-managed internal notifications.
-- Additive only: configuration (enabled + destination) and an auditable
-- delivery log with frozen rendered text. No business logic in these tables.
CREATE TABLE "AdminReportConfig" (
    "reportNumber" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "waAccountId" TEXT,
    "waChatId" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminReportConfig_pkey" PRIMARY KEY ("reportNumber")
);

CREATE TABLE "AdminReportDelivery" (
    "id" TEXT NOT NULL,
    "reportNumber" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "skipReason" TEXT,
    "dealId" TEXT,
    "payload" JSONB,
    "renderedText" TEXT,
    "waAccountId" TEXT,
    "waChatId" TEXT,
    "destinationLabel" TEXT,
    "providerMessageId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminReportDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminReportDelivery_reportNumber_idempotencyKey_key" ON "AdminReportDelivery"("reportNumber", "idempotencyKey");
CREATE INDEX "AdminReportDelivery_reportNumber_createdAt_idx" ON "AdminReportDelivery"("reportNumber", "createdAt");
CREATE INDEX "AdminReportDelivery_status_nextRetryAt_idx" ON "AdminReportDelivery"("status", "nextRetryAt");
