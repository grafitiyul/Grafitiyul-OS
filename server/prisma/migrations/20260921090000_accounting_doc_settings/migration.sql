-- Accounting document default notes (Finance Settings → פרטי בנק גרפיטיול) —
-- singleton row (id='singleton'), lazily seeded on first read (same convention
-- as TourSettings / GuidePortalSettings). Structured bank fields + three
-- customer-facing template blocks with independent per-doctype inclusion
-- flags. Affects FUTURE documents only; issued iCount documents are immutable.

-- CreateTable
CREATE TABLE "AccountingDocSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "bankAccountHolder" TEXT NOT NULL DEFAULT '',
    "bankName" TEXT NOT NULL DEFAULT '',
    "bankNumber" TEXT NOT NULL DEFAULT '',
    "bankBranchName" TEXT NOT NULL DEFAULT '',
    "bankBranchNumber" TEXT NOT NULL DEFAULT '',
    "bankAccountNumber" TEXT NOT NULL DEFAULT '',
    "dealInfoTemplate" TEXT NOT NULL DEFAULT '',
    "bankTemplate" TEXT NOT NULL DEFAULT '',
    "cancellationTemplate" TEXT NOT NULL DEFAULT '',
    "dealInfoIncludeDeal" BOOLEAN NOT NULL DEFAULT true,
    "dealInfoIncludeInvoice" BOOLEAN NOT NULL DEFAULT false,
    "bankIncludeDeal" BOOLEAN NOT NULL DEFAULT true,
    "bankIncludeInvoice" BOOLEAN NOT NULL DEFAULT false,
    "cancellationIncludeDeal" BOOLEAN NOT NULL DEFAULT true,
    "cancellationIncludeInvoice" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "AccountingDocSettings_pkey" PRIMARY KEY ("id")
);
