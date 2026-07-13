-- Open Tours foundation: recurring templates + schedule rules + one-off
-- exceptions, and the canonical source-agnostic TicketRegistration. Purely
-- additive — no existing table is dropped or rewritten. Behaviour is wired in
-- later slices; these tables start empty (except the new TourEvent columns,
-- which default safely on existing rows).

-- ── OpenTourTemplate ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "OpenTourTemplate" (
    "id" TEXT NOT NULL,
    "nameHe" TEXT NOT NULL,
    "nameEn" TEXT,
    "locationId" TEXT,
    "meetingPoint" TEXT,
    "tourLanguage" TEXT NOT NULL DEFAULT 'he',
    "durationHoursOverride" DOUBLE PRECISION,
    "capacity" INTEGER,
    "registrationCloseMinutes" INTEGER,
    "defaultLeadGuides" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OpenTourTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OpenTourTemplate_active_idx" ON "OpenTourTemplate"("active");
CREATE INDEX IF NOT EXISTS "OpenTourTemplate_locationId_idx" ON "OpenTourTemplate"("locationId");

ALTER TABLE "OpenTourTemplate"
  ADD CONSTRAINT "OpenTourTemplate_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── OpenTourTemplateProduct ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "OpenTourTemplateProduct" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "productVariantId" TEXT,
    "priceRuleId" TEXT,
    "cardGroupId" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OpenTourTemplateProduct_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OpenTourTemplateProduct_templateId_idx" ON "OpenTourTemplateProduct"("templateId");
CREATE INDEX IF NOT EXISTS "OpenTourTemplateProduct_productVariantId_idx" ON "OpenTourTemplateProduct"("productVariantId");

ALTER TABLE "OpenTourTemplateProduct"
  ADD CONSTRAINT "OpenTourTemplateProduct_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "OpenTourTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OpenTourTemplateProduct"
  ADD CONSTRAINT "OpenTourTemplateProduct_productVariantId_fkey"
  FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── OpenTourScheduleRule ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "OpenTourScheduleRule" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "validFrom" TEXT,
    "validUntil" TEXT,
    "season" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "generatedThrough" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OpenTourScheduleRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OpenTourScheduleRule_templateId_active_weekday_idx" ON "OpenTourScheduleRule"("templateId", "active", "weekday");

ALTER TABLE "OpenTourScheduleRule"
  ADD CONSTRAINT "OpenTourScheduleRule_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "OpenTourTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── OpenTourScheduleException ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "OpenTourScheduleException" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "time" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OpenTourScheduleException_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OpenTourScheduleException_templateId_date_type_key" ON "OpenTourScheduleException"("templateId", "date", "type");
CREATE INDEX IF NOT EXISTS "OpenTourScheduleException_templateId_date_idx" ON "OpenTourScheduleException"("templateId", "date");

ALTER TABLE "OpenTourScheduleException"
  ADD CONSTRAINT "OpenTourScheduleException_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "OpenTourTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── TicketRegistration (canonical ticket allocation SSOT) ────────────────────
CREATE TABLE IF NOT EXISTS "TicketRegistration" (
    "id" TEXT NOT NULL,
    "tourEventId" TEXT NOT NULL,
    "productVariantId" TEXT,
    "priceRuleId" TEXT,
    "cardGroupId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL DEFAULT 'admin',
    "bookingId" TEXT,
    "dealId" TEXT,
    "externalOrderId" TEXT,
    "externalLineId" TEXT,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "paymentStatus" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TicketRegistration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TicketRegistration_source_externalOrderId_externalLineId_key" ON "TicketRegistration"("source", "externalOrderId", "externalLineId");
CREATE INDEX IF NOT EXISTS "TicketRegistration_tourEventId_status_idx" ON "TicketRegistration"("tourEventId", "status");
CREATE INDEX IF NOT EXISTS "TicketRegistration_productVariantId_idx" ON "TicketRegistration"("productVariantId");
CREATE INDEX IF NOT EXISTS "TicketRegistration_bookingId_idx" ON "TicketRegistration"("bookingId");
CREATE INDEX IF NOT EXISTS "TicketRegistration_dealId_idx" ON "TicketRegistration"("dealId");

ALTER TABLE "TicketRegistration"
  ADD CONSTRAINT "TicketRegistration_tourEventId_fkey"
  FOREIGN KEY ("tourEventId") REFERENCES "TourEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TicketRegistration"
  ADD CONSTRAINT "TicketRegistration_productVariantId_fkey"
  FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TicketRegistration"
  ADD CONSTRAINT "TicketRegistration_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TicketRegistration"
  ADD CONSTRAINT "TicketRegistration_dealId_fkey"
  FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── TourEvent: link to template + manual-override guard ──────────────────────
ALTER TABLE "TourEvent" ADD COLUMN IF NOT EXISTS "openTourTemplateId" TEXT;
ALTER TABLE "TourEvent" ADD COLUMN IF NOT EXISTS "productManualOverride" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "TourEvent_openTourTemplateId_date_idx" ON "TourEvent"("openTourTemplateId", "date");
