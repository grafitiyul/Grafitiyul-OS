-- Tours operational module — TourEvent + Booking.
-- TourEvent is the operational execution instance ("סיור"); Booking is the ONE
-- relationship layer between Deal (commercial) and TourEvent (operational).
-- Purely additive: two new tables, no existing table is touched.

CREATE TABLE IF NOT EXISTS "TourEvent" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "date" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "productId" TEXT,
    "productVariantId" TEXT,
    "locationId" TEXT,
    "tourLanguage" TEXT,
    "capacity" INTEGER,
    "notes" TEXT,
    "generatedByRuleId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TourEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TourEvent_generatedByRuleId_date_key" ON "TourEvent"("generatedByRuleId", "date");
CREATE INDEX IF NOT EXISTS "TourEvent_date_startTime_idx" ON "TourEvent"("date", "startTime");
CREATE INDEX IF NOT EXISTS "TourEvent_kind_status_date_idx" ON "TourEvent"("kind", "status", "date");
CREATE INDEX IF NOT EXISTS "TourEvent_productId_idx" ON "TourEvent"("productId");
CREATE INDEX IF NOT EXISTS "TourEvent_productVariantId_idx" ON "TourEvent"("productVariantId");
CREATE INDEX IF NOT EXISTS "TourEvent_locationId_idx" ON "TourEvent"("locationId");

ALTER TABLE "TourEvent"
  ADD CONSTRAINT "TourEvent_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TourEvent"
  ADD CONSTRAINT "TourEvent_productVariantId_fkey"
  FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TourEvent"
  ADD CONSTRAINT "TourEvent_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "Booking" (
    "id" TEXT NOT NULL,
    "tourEventId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "seats" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "cancelledAt" TIMESTAMP(3),
    "orphanedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Booking_tourEventId_status_idx" ON "Booking"("tourEventId", "status");
CREATE INDEX IF NOT EXISTS "Booking_dealId_status_idx" ON "Booking"("dealId", "status");

-- Product rule: a deal participates in at most ONE tour at a time. Cancelled/
-- orphaned rows keep history without blocking a new active booking.
-- (Partial index — intentionally not expressible in schema.prisma; documented
-- there on the Booking model.)
CREATE UNIQUE INDEX IF NOT EXISTS "Booking_one_active_per_deal_key" ON "Booking"("dealId") WHERE "status" = 'active';

-- Restrict on BOTH relations: a TourEvent with bookings can never be deleted
-- (product rule: only empty tours may be deleted), and a Deal must be
-- disconnected from its tour before deletion.
ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_tourEventId_fkey"
  FOREIGN KEY ("tourEventId") REFERENCES "TourEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_dealId_fkey"
  FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
