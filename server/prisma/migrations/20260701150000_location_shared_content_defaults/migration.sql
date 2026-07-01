-- Shared Content — Location Defaults.
--
-- Location defaults become explicit references: a Location points at the Shared
-- Content it uses by default per type (meeting / ending). A variant link is an
-- override. ADDITIVE + non-destructive: two nullable FK columns + a data backfill
-- from the existing Slice-2 `SharedContent.isLocationDefault` flag. Nothing is
-- deleted; the flag column is kept (deprecated).

-- AddColumn
ALTER TABLE "Location" ADD COLUMN "defaultMeetingPointId" TEXT;
ALTER TABLE "Location" ADD COLUMN "defaultEndingPointId" TEXT;

-- CreateIndex
CREATE INDEX "Location_defaultMeetingPointId_idx" ON "Location"("defaultMeetingPointId");
CREATE INDEX "Location_defaultEndingPointId_idx" ON "Location"("defaultEndingPointId");

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_defaultMeetingPointId_fkey" FOREIGN KEY ("defaultMeetingPointId") REFERENCES "SharedContent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Location" ADD CONSTRAINT "Location_defaultEndingPointId_fkey" FOREIGN KEY ("defaultEndingPointId") REFERENCES "SharedContent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: promote existing location-default blocks (isLocationDefault=true,
-- anchored to the location) into the new explicit FK references. Idempotent (only
-- fills when the FK is still null).
UPDATE "Location" l
   SET "defaultMeetingPointId" = sc.id
  FROM "SharedContent" sc
 WHERE sc."locationId" = l.id
   AND sc."type" = 'meeting_point'
   AND sc."isLocationDefault" = true
   AND l."defaultMeetingPointId" IS NULL;

UPDATE "Location" l
   SET "defaultEndingPointId" = sc.id
  FROM "SharedContent" sc
 WHERE sc."locationId" = l.id
   AND sc."type" = 'ending_point'
   AND sc."isLocationDefault" = true
   AND l."defaultEndingPointId" IS NULL;
