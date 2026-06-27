-- שעות שבת וחג — Sabbath & Holiday hours module.
--
-- ADDITIVE ONLY. Two new tables (SabbathWeeklyRule recurring windows +
-- HolidayRule dated rows with review workflow), their indexes/unique constraint.
-- No existing table changes; no pricing/Deals/Quotes/payments touched. Defensive
-- (IF NOT EXISTS) so it is safe to re-run.

CREATE TABLE IF NOT EXISTS "SabbathWeeklyRule" (
    "id" TEXT NOT NULL,
    "nameHe" TEXT NOT NULL,
    "nameEn" TEXT,
    "dayOfWeek" INTEGER NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "startMinute" INTEGER,
    "endMinute" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SabbathWeeklyRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "HolidayRule" (
    "id" TEXT NOT NULL,
    "nameHe" TEXT NOT NULL,
    "nameEn" TEXT,
    "date" DATE NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT true,
    "startMinute" INTEGER,
    "endMinute" INTEGER,
    "type" TEXT NOT NULL DEFAULT 'chag',
    "source" TEXT NOT NULL DEFAULT 'imported',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "externalId" TEXT,
    "manuallyEdited" BOOLEAN NOT NULL DEFAULT false,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "sourceName" TEXT,
    "sourceDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HolidayRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SabbathWeeklyRule_sortOrder_idx" ON "SabbathWeeklyRule"("sortOrder");
CREATE UNIQUE INDEX IF NOT EXISTS "HolidayRule_source_externalId_key" ON "HolidayRule"("source", "externalId");
CREATE INDEX IF NOT EXISTS "HolidayRule_date_idx" ON "HolidayRule"("date");
CREATE INDEX IF NOT EXISTS "HolidayRule_status_idx" ON "HolidayRule"("status");
