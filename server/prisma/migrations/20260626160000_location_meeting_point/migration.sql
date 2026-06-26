-- AlterTable: enrich Location with meeting-point text + image (all additive, nullable)
ALTER TABLE "Location" ADD COLUMN "meetingPointHe" TEXT;
ALTER TABLE "Location" ADD COLUMN "meetingPointEn" TEXT;
ALTER TABLE "Location" ADD COLUMN "meetingPointImageId" TEXT;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_meetingPointImageId_fkey" FOREIGN KEY ("meetingPointImageId") REFERENCES "MediaFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
