-- Automatic group-slot scheduling: recurring weekly rules + module settings
-- singleton. Purely additive.

CREATE TABLE IF NOT EXISTS "TourScheduleRule" (
    "id" TEXT NOT NULL,
    "productId" TEXT,
    "productVariantId" TEXT,
    "weekday" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "tourLanguage" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "generatedThrough" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TourScheduleRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TourScheduleRule_active_weekday_idx" ON "TourScheduleRule"("active", "weekday");

ALTER TABLE "TourScheduleRule"
  ADD CONSTRAINT "TourScheduleRule_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TourScheduleRule"
  ADD CONSTRAINT "TourScheduleRule_productVariantId_fkey"
  FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "TourSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "defaultCapacity" INTEGER NOT NULL DEFAULT 30,
    "generateDaysAhead" INTEGER NOT NULL DEFAULT 60,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TourSettings_pkey" PRIMARY KEY ("id")
);
