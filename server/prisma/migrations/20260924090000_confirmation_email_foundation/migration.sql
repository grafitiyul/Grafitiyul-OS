-- Confirmation Email module (מייל אישור) — Slice 1 foundation. Purely additive.
--
-- New: ConfirmationEmailTemplate (+ block join), DealConfirmation (per-deal
-- fillers + preview overrides), ConfirmationEmailSend (immutable snapshots),
-- Deal.durationHours (structured operator override, changelog-tracked),
-- Location.logisticsHe/En (bilingual rich HTML for the email's logistics
-- section). Delivery rides the existing ScheduledEmail queue — no new
-- delivery tables. Design: docs/architecture/GOS-confirmation-email-module-2026-08-03.md.

-- Deal: operator-confirmed duration override (hours). NULL = canonical chain.
ALTER TABLE "Deal" ADD COLUMN "durationHours" DOUBLE PRECISION;

-- Location: confirmation-email logistics content.
ALTER TABLE "Location" ADD COLUMN "logisticsHe" TEXT;
ALTER TABLE "Location" ADD COLUMN "logisticsEn" TEXT;

-- CreateTable
CREATE TABLE "ConfirmationEmailTemplate" (
    "id" TEXT NOT NULL,
    "internalName" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "productIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "activityTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "orgTypeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "priority" INTEGER NOT NULL DEFAULT 0,
    "sections" JSONB,
    "subjectHe" TEXT,
    "subjectEn" TEXT,
    "greetingHe" TEXT,
    "greetingEn" TEXT,
    "closingHe" TEXT,
    "closingEn" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfirmationEmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfirmationTemplateBlock" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "sharedContentId" TEXT NOT NULL,

    CONSTRAINT "ConfirmationTemplateBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealConfirmation" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "fillers" JSONB,
    "overrideState" JSONB,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DealConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfirmationEmailSend" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "templateId" TEXT,
    "templateName" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "recipientSnapshot" JSONB NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "fillersSnapshot" JSONB,
    "overridesSnapshot" JSONB,
    "imagesSnapshot" JSONB,
    "scheduledEmailId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfirmationEmailSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConfirmationEmailTemplate_active_isDefault_idx" ON "ConfirmationEmailTemplate"("active", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "ConfirmationTemplateBlock_templateId_sharedContentId_key" ON "ConfirmationTemplateBlock"("templateId", "sharedContentId");

-- CreateIndex
CREATE INDEX "ConfirmationTemplateBlock_sharedContentId_idx" ON "ConfirmationTemplateBlock"("sharedContentId");

-- CreateIndex
CREATE UNIQUE INDEX "DealConfirmation_dealId_key" ON "DealConfirmation"("dealId");

-- CreateIndex
CREATE INDEX "ConfirmationEmailSend_dealId_createdAt_idx" ON "ConfirmationEmailSend"("dealId", "createdAt");

-- CreateIndex
CREATE INDEX "ConfirmationEmailSend_scheduledEmailId_idx" ON "ConfirmationEmailSend"("scheduledEmailId");

-- AddForeignKey
ALTER TABLE "ConfirmationTemplateBlock" ADD CONSTRAINT "ConfirmationTemplateBlock_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ConfirmationEmailTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfirmationTemplateBlock" ADD CONSTRAINT "ConfirmationTemplateBlock_sharedContentId_fkey" FOREIGN KEY ("sharedContentId") REFERENCES "SharedContent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealConfirmation" ADD CONSTRAINT "DealConfirmation_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
