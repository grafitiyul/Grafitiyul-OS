-- CreateTable
CREATE TABLE "Tour" (
    "id" TEXT NOT NULL,
    "sourceRef" TEXT,
    "titleHe" TEXT NOT NULL,
    "descriptionHe" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tour_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TourStation" (
    "id" TEXT NOT NULL,
    "sourceRef" TEXT,
    "tourId" TEXT NOT NULL,
    "titleHe" TEXT NOT NULL,
    "descriptionHe" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'location',
    "heroImageId" TEXT,
    "heroImageTitle" TEXT,
    "locationId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TourStation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TourContentBlock" (
    "id" TEXT NOT NULL,
    "sourceRef" TEXT,
    "titleHe" TEXT,
    "bodyHe" TEXT NOT NULL DEFAULT '',
    "internalNote" TEXT,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TourContentBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TourStep" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "contentBlockId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "roleHint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TourStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TourBlockAsset" (
    "id" TEXT NOT NULL,
    "sourceRef" TEXT,
    "contentBlockId" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "language" TEXT,
    "titleHe" TEXT NOT NULL,
    "url" TEXT,
    "mediaId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TourBlockAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TourStationNote" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "contentHe" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TourStationNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tour_sourceRef_key" ON "Tour"("sourceRef");

-- CreateIndex
CREATE UNIQUE INDEX "TourStation_sourceRef_key" ON "TourStation"("sourceRef");

-- CreateIndex
CREATE INDEX "TourStation_tourId_sortOrder_idx" ON "TourStation"("tourId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "TourContentBlock_sourceRef_key" ON "TourContentBlock"("sourceRef");

-- CreateIndex
CREATE INDEX "TourStep_stationId_sortOrder_idx" ON "TourStep"("stationId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "TourBlockAsset_sourceRef_key" ON "TourBlockAsset"("sourceRef");

-- CreateIndex
CREATE INDEX "TourBlockAsset_contentBlockId_sortOrder_idx" ON "TourBlockAsset"("contentBlockId", "sortOrder");

-- CreateIndex
CREATE INDEX "TourStationNote_stationId_sortOrder_idx" ON "TourStationNote"("stationId", "sortOrder");

-- AddForeignKey
ALTER TABLE "TourStation" ADD CONSTRAINT "TourStation_tourId_fkey" FOREIGN KEY ("tourId") REFERENCES "Tour"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TourStation" ADD CONSTRAINT "TourStation_heroImageId_fkey" FOREIGN KEY ("heroImageId") REFERENCES "MediaFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TourStep" ADD CONSTRAINT "TourStep_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "TourStation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TourStep" ADD CONSTRAINT "TourStep_contentBlockId_fkey" FOREIGN KEY ("contentBlockId") REFERENCES "TourContentBlock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TourBlockAsset" ADD CONSTRAINT "TourBlockAsset_contentBlockId_fkey" FOREIGN KEY ("contentBlockId") REFERENCES "TourContentBlock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TourBlockAsset" ADD CONSTRAINT "TourBlockAsset_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TourStationNote" ADD CONSTRAINT "TourStationNote_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "TourStation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

