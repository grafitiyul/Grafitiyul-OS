-- CreateTable
CREATE TABLE "CommunicationEvent" (
    "id" TEXT NOT NULL,
    "internalName" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "triggerType" TEXT NOT NULL,
    "anchorType" TEXT NOT NULL DEFAULT 'trigger_time',
    "timingMode" TEXT NOT NULL DEFAULT 'immediate',
    "timingAmount" INTEGER,
    "timingUnit" TEXT,
    "activityMode" TEXT NOT NULL DEFAULT 'all',
    "activityTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "orgTypeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "orgSubtypeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "conditions" JSONB,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationMessage" (
    "id" TEXT NOT NULL,
    "publicNumber" SERIAL NOT NULL,
    "eventId" TEXT NOT NULL,
    "internalName" TEXT,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "audienceType" TEXT NOT NULL DEFAULT 'primary_contact',
    "audienceContactId" TEXT,
    "audiencePersonRefId" TEXT,
    "waAccountId" TEXT,
    "waDestinationType" TEXT,
    "waGroupChatId" TEXT,
    "windowEnabled" BOOLEAN NOT NULL DEFAULT false,
    "sendingWindowId" TEXT,
    "languagePolicy" TEXT NOT NULL DEFAULT 'auto',
    "fallbackLanguage" TEXT NOT NULL DEFAULT 'he',
    "attachments" JSONB,
    "draftContent" JSONB,
    "publishedVersionId" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationMessageVersion" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationMessageVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationDelivery" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "messageNumber" INTEGER NOT NULL,
    "versionId" TEXT,
    "channel" TEXT NOT NULL,
    "language" TEXT,
    "triggerKey" TEXT NOT NULL,
    "recipientKey" TEXT NOT NULL,
    "dealId" TEXT,
    "tourEventId" TEXT,
    "sessionId" TEXT,
    "contactId" TEXT,
    "recipientSnapshot" JSONB,
    "renderedContent" JSONB,
    "intendedAt" TIMESTAMP(3) NOT NULL,
    "effectiveAt" TIMESTAMP(3),
    "waitReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "skipReason" TEXT,
    "claimedAt" TIMESTAMP(3),
    "claimedBy" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "lastError" TEXT,
    "providerMessageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationSendingWindow" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "rules" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationSendingWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationWindowException" (
    "id" TEXT NOT NULL,
    "windowId" TEXT,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "dateFrom" TEXT NOT NULL,
    "dateTo" TEXT,
    "startTime" TEXT,
    "endTime" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationWindowException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationTestSend" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "language" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationTestSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommunicationEvent_status_triggerType_idx" ON "CommunicationEvent"("status", "triggerType");

-- CreateIndex
CREATE INDEX "CommunicationEvent_updatedAt_idx" ON "CommunicationEvent"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationMessage_publicNumber_key" ON "CommunicationMessage"("publicNumber");

-- CreateIndex
CREATE INDEX "CommunicationMessage_eventId_idx" ON "CommunicationMessage"("eventId");

-- CreateIndex
CREATE INDEX "CommunicationMessage_channel_status_idx" ON "CommunicationMessage"("channel", "status");

-- CreateIndex
CREATE INDEX "CommunicationMessage_updatedAt_idx" ON "CommunicationMessage"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationMessageVersion_messageId_versionNo_key" ON "CommunicationMessageVersion"("messageId", "versionNo");

-- CreateIndex
CREATE INDEX "CommunicationDelivery_status_intendedAt_idx" ON "CommunicationDelivery"("status", "intendedAt");

-- CreateIndex
CREATE INDEX "CommunicationDelivery_status_nextRetryAt_idx" ON "CommunicationDelivery"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "CommunicationDelivery_dealId_idx" ON "CommunicationDelivery"("dealId");

-- CreateIndex
CREATE INDEX "CommunicationDelivery_messageId_createdAt_idx" ON "CommunicationDelivery"("messageId", "createdAt");

-- CreateIndex
CREATE INDEX "CommunicationDelivery_createdAt_idx" ON "CommunicationDelivery"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationDelivery_messageId_triggerKey_recipientKey_key" ON "CommunicationDelivery"("messageId", "triggerKey", "recipientKey");

-- CreateIndex
CREATE INDEX "CommunicationWindowException_windowId_idx" ON "CommunicationWindowException"("windowId");

-- CreateIndex
CREATE INDEX "CommunicationWindowException_active_dateFrom_idx" ON "CommunicationWindowException"("active", "dateFrom");

-- CreateIndex
CREATE INDEX "CommunicationTestSend_messageId_createdAt_idx" ON "CommunicationTestSend"("messageId", "createdAt");

-- AddForeignKey
ALTER TABLE "CommunicationMessage" ADD CONSTRAINT "CommunicationMessage_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CommunicationEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationMessage" ADD CONSTRAINT "CommunicationMessage_sendingWindowId_fkey" FOREIGN KEY ("sendingWindowId") REFERENCES "CommunicationSendingWindow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationMessage" ADD CONSTRAINT "CommunicationMessage_publishedVersionId_fkey" FOREIGN KEY ("publishedVersionId") REFERENCES "CommunicationMessageVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationMessageVersion" ADD CONSTRAINT "CommunicationMessageVersion_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "CommunicationMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationDelivery" ADD CONSTRAINT "CommunicationDelivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CommunicationEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationDelivery" ADD CONSTRAINT "CommunicationDelivery_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "CommunicationMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationDelivery" ADD CONSTRAINT "CommunicationDelivery_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "CommunicationMessageVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationWindowException" ADD CONSTRAINT "CommunicationWindowException_windowId_fkey" FOREIGN KEY ("windowId") REFERENCES "CommunicationSendingWindow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationTestSend" ADD CONSTRAINT "CommunicationTestSend_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "CommunicationMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

