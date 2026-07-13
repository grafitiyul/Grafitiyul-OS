-- WooCommerce GOS→Woo synchronization: per-TourEvent outbox flags + the
-- canonical card→product mapping + the per-(tour × card) variation link.
-- Purely additive; the new TourEvent columns default safely on existing rows.

-- ── TourEvent: Woo mirror outbox flags ──────────────────────────────────────
ALTER TABLE "TourEvent" ADD COLUMN IF NOT EXISTS "wooSyncStatus" TEXT;
ALTER TABLE "TourEvent" ADD COLUMN IF NOT EXISTS "wooSyncError" TEXT;
ALTER TABLE "TourEvent" ADD COLUMN IF NOT EXISTS "wooSyncedAt" TIMESTAMP(3);
ALTER TABLE "TourEvent" ADD COLUMN IF NOT EXISTS "wooAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TourEvent" ADD COLUMN IF NOT EXISTS "wooNextRetryAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "TourEvent_wooSyncStatus_wooNextRetryAt_idx" ON "TourEvent"("wooSyncStatus", "wooNextRetryAt");

-- ── WooProductMapping ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "WooProductMapping" (
    "id" TEXT NOT NULL,
    "cardGroupId" TEXT NOT NULL,
    "wooProductId" INTEGER NOT NULL,
    "dateAttribute" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WooProductMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WooProductMapping_cardGroupId_key" ON "WooProductMapping"("cardGroupId");

-- ── WooVariationLink ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "WooVariationLink" (
    "id" TEXT NOT NULL,
    "tourEventId" TEXT NOT NULL,
    "cardGroupId" TEXT NOT NULL,
    "wooProductId" INTEGER NOT NULL,
    "wooVariationId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WooVariationLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WooVariationLink_tourEventId_cardGroupId_key" ON "WooVariationLink"("tourEventId", "cardGroupId");
CREATE INDEX IF NOT EXISTS "WooVariationLink_tourEventId_idx" ON "WooVariationLink"("tourEventId");

ALTER TABLE "WooVariationLink"
  ADD CONSTRAINT "WooVariationLink_tourEventId_fkey"
  FOREIGN KEY ("tourEventId") REFERENCES "TourEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
