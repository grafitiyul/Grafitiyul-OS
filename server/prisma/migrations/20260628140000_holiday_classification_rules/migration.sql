-- Holiday classification rules — carry a reviewed holiday classification forward
-- to future years' imports.
--
-- ADDITIVE ONLY. One new table. No existing table changes. No pricing/Deals/
-- Quotes changes. Idempotent.

CREATE TABLE IF NOT EXISTS "HolidayClassificationRule" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "normalizedHolidayKey" TEXT NOT NULL,
    "defaultType" TEXT NOT NULL,
    "defaultStartMinute" INTEGER,
    "defaultEndMinute" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HolidayClassificationRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "HolidayClassificationRule_source_normalizedHolidayKey_key"
  ON "HolidayClassificationRule"("source", "normalizedHolidayKey");
