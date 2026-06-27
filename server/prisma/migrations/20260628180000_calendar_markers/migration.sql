-- Calendar Markers — operational date markers, independent of pricing.
--
-- ADDITIVE: two new tables (CalendarMarkerType catalog + CalendarMarker dated
-- instances), seeded marker types, and a one-time redirect of Chol HaMoed from
-- the pricing HolidayRule into markers. The pricing engine never reads these
-- tables. Idempotent.

CREATE TABLE IF NOT EXISTS "CalendarMarkerType" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nameHe" TEXT NOT NULL,
    "nameEn" TEXT,
    "color" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CalendarMarkerType_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CalendarMarker" (
    "id" TEXT NOT NULL,
    "markerTypeId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "nameHe" TEXT,
    "note" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "externalId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CalendarMarker_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CalendarMarkerType_key_key" ON "CalendarMarkerType"("key");
CREATE INDEX IF NOT EXISTS "CalendarMarkerType_sortOrder_idx" ON "CalendarMarkerType"("sortOrder");
CREATE UNIQUE INDEX IF NOT EXISTS "CalendarMarker_source_externalId_key" ON "CalendarMarker"("source", "externalId");
CREATE INDEX IF NOT EXISTS "CalendarMarker_startDate_idx" ON "CalendarMarker"("startDate");
CREATE INDEX IF NOT EXISTS "CalendarMarker_endDate_idx" ON "CalendarMarker"("endDate");
CREATE INDEX IF NOT EXISTS "CalendarMarker_markerTypeId_idx" ON "CalendarMarker"("markerTypeId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CalendarMarker_markerTypeId_fkey') THEN
    ALTER TABLE "CalendarMarker" ADD CONSTRAINT "CalendarMarker_markerTypeId_fkey" FOREIGN KEY ("markerTypeId") REFERENCES "CalendarMarkerType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Seed marker types. chol_hamoed is a SYSTEM type the import depends on; the rest
-- are editable starters. Every row supplies all 9 columns (createdAt/updatedAt
-- explicit via NOW()); idempotent via ON CONFLICT on the unique key.
INSERT INTO "CalendarMarkerType" ("id","key","nameHe","nameEn","color","source","sortOrder","createdAt","updatedAt")
VALUES
  ('markertype_chol_hamoed','chol_hamoed','חול המועד','Chol HaMoed','#f59e0b','system',0, NOW(), NOW()),
  ('markertype_school_vacation','school_vacation','חופשת בית ספר','School Vacation','#3b82f6','manual',1, NOW(), NOW()),
  ('markertype_election_day','election_day','יום בחירות','Election Day','#8b5cf6','manual',2, NOW(), NOW()),
  ('markertype_municipal_event','municipal_event','אירוע עירוני','Municipal Event','#10b981','manual',3, NOW(), NOW()),
  ('markertype_high_demand','high_demand','תקופת ביקוש גבוה','High Demand','#ef4444','manual',4, NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;

-- Redirect existing Chol HaMoed: move CH"M holiday rows (still classified 'other')
-- into markers, then remove them from the pricing HolidayRule. Match the Hebcal
-- CH"M title shape "(CH…"; deterministic id keeps it idempotent. Manually
-- reclassified CH"M rows (type <> 'other') are left untouched.
INSERT INTO "CalendarMarker" ("id","markerTypeId","startDate","endDate","nameHe","source","externalId","active","createdAt","updatedAt")
SELECT 'cm_' || h."id",'markertype_chol_hamoed', h."date", h."date", h."nameHe", 'imported', h."externalId", true, NOW(), NOW()
FROM "HolidayRule" h
WHERE h."sourceName" LIKE '%(CH%' AND h."type" = 'other'
  AND NOT EXISTS (SELECT 1 FROM "CalendarMarker" m WHERE m."id" = 'cm_' || h."id")
ON CONFLICT ("source","externalId") DO NOTHING;

DELETE FROM "HolidayRule" WHERE "sourceName" LIKE '%(CH%' AND "type" = 'other';
