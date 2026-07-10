-- Activity Components + Workshop Locations catalogs (Tours module, Slice A).
-- Two independent catalog tables, same shape family as TaskType/OrganizationType
-- (sortOrder + isActive soft-delete). Purely additive — no existing table is
-- touched, no data is migrated. Join tables to Product/TourEvent land in later
-- additive migrations (Slices B/C).

CREATE TABLE IF NOT EXISTS "ActivityComponent" (
    "id" TEXT NOT NULL,
    "nameHe" TEXT NOT NULL,
    "nameEn" TEXT,
    "icon" TEXT,
    "color" TEXT,
    "isWorkshop" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ActivityComponent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ActivityComponent_sortOrder_idx" ON "ActivityComponent"("sortOrder");

CREATE TABLE IF NOT EXISTS "WorkshopLocation" (
    "id" TEXT NOT NULL,
    "nameHe" TEXT NOT NULL,
    "address" TEXT,
    "instructions" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkshopLocation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "WorkshopLocation_sortOrder_idx" ON "WorkshopLocation"("sortOrder");
