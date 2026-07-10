-- TourEvent delivered components (Tours module, Slice C). The operational truth:
-- what a specific tour actually delivers, seeded from the Product defaults at
-- creation and owned by the tour thereafter. workshopLocationId lives per-row
-- because one tour can hold several workshop components in DIFFERENT locations.
-- Purely additive — new join table only.
-- ON DELETE: tour link Cascades with the tour; component + location are Restrict
-- (a referenced catalog entry is deactivated by the API, never hard-deleted).

CREATE TABLE IF NOT EXISTS "TourEventActivityComponent" (
    "id" TEXT NOT NULL,
    "tourEventId" TEXT NOT NULL,
    "activityComponentId" TEXT NOT NULL,
    "workshopLocationId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TourEventActivityComponent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TourEventActivityComponent_tourEventId_activityComponentId_key" ON "TourEventActivityComponent"("tourEventId", "activityComponentId");
CREATE INDEX IF NOT EXISTS "TourEventActivityComponent_tourEventId_idx" ON "TourEventActivityComponent"("tourEventId");
CREATE INDEX IF NOT EXISTS "TourEventActivityComponent_activityComponentId_idx" ON "TourEventActivityComponent"("activityComponentId");
CREATE INDEX IF NOT EXISTS "TourEventActivityComponent_workshopLocationId_idx" ON "TourEventActivityComponent"("workshopLocationId");

ALTER TABLE "TourEventActivityComponent"
  ADD CONSTRAINT "TourEventActivityComponent_tourEventId_fkey"
  FOREIGN KEY ("tourEventId") REFERENCES "TourEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TourEventActivityComponent"
  ADD CONSTRAINT "TourEventActivityComponent_activityComponentId_fkey"
  FOREIGN KEY ("activityComponentId") REFERENCES "ActivityComponent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TourEventActivityComponent"
  ADD CONSTRAINT "TourEventActivityComponent_workshopLocationId_fkey"
  FOREIGN KEY ("workshopLocationId") REFERENCES "WorkshopLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
