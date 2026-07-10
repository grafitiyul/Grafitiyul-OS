-- CreateTable
CREATE TABLE "TourGalleryExport" (
    "id" TEXT NOT NULL,
    "tourEventId" TEXT NOT NULL,
    "galleryId" TEXT NOT NULL,
    "requestedByType" TEXT NOT NULL,
    "requestedByLinkId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "archiveKey" TEXT,
    "byteSize" BIGINT,
    "mediaCount" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TourGalleryExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TourGalleryExport_tourEventId_status_idx" ON "TourGalleryExport"("tourEventId", "status");

-- CreateIndex
CREATE INDEX "TourGalleryExport_status_updatedAt_idx" ON "TourGalleryExport"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "TourGalleryExport_status_expiresAt_idx" ON "TourGalleryExport"("status", "expiresAt");

