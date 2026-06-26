-- CRM Settings — Lost Reasons & Quote Content Sections (catalog only).
--
-- ADDITIVE ONLY. Two new standalone tables. Nothing is dropped or altered, and
-- nothing is wired to Deals or quote generation yet. Written defensively
-- (IF NOT EXISTS) so it is safe to run once and harmless if any object already
-- exists.

-- ── Lost Reasons ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "LostReason" (
    "id" TEXT NOT NULL,
    "nameHe" TEXT NOT NULL,
    "nameEn" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LostReason_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "LostReason_sortOrder_idx" ON "LostReason"("sortOrder");

-- ── Quote Content Sections ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "QuoteSection" (
    "id" TEXT NOT NULL,
    "titleHe" TEXT NOT NULL,
    "titleEn" TEXT,
    "richTextHe" TEXT,
    "richTextEn" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteSection_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "QuoteSection_sortOrder_idx" ON "QuoteSection"("sortOrder");
