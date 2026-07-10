-- CreateTable
CREATE TABLE "TourGallery" (
    "id" TEXT NOT NULL,
    "tourEventId" TEXT NOT NULL,
    "coverMediaId" TEXT,
    "customerUploadEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TourGallery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TourMedia" (
    "id" TEXT NOT NULL,
    "galleryId" TEXT NOT NULL,
    "tourEventId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "thumbKey" TEXT,
    "posterKey" TEXT,
    "mediaType" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "byteSize" BIGINT,
    "width" INTEGER,
    "height" INTEGER,
    "durationSeconds" DOUBLE PRECISION,
    "capturedAt" TIMESTAMP(3),
    "checksum" TEXT,
    "uploadStatus" TEXT NOT NULL DEFAULT 'pending',
    "uploadId" TEXT,
    "partSize" INTEGER,
    "batchId" TEXT,
    "uploadedByType" TEXT NOT NULL,
    "uploadedById" TEXT,
    "uploadedByPersonRefId" TEXT,
    "uploadedByLinkId" TEXT,
    "uploadedByLabel" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TourMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TourGalleryLink" (
    "id" TEXT NOT NULL,
    "galleryId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "TourGalleryLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TourGalleryCleanupTask" (
    "id" TEXT NOT NULL,
    "tourEventId" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "deletedObjects" INTEGER,
    "notBefore" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TourGalleryCleanupTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TourGallerySettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "guideCanDelete" BOOLEAN NOT NULL DEFAULT true,
    "guideCanShareCustomerLink" BOOLEAN NOT NULL DEFAULT true,
    "customerUploadEnabled" BOOLEAN NOT NULL DEFAULT true,
    "publicBrandingText" TEXT,
    "archiveExpiryHours" INTEGER NOT NULL DEFAULT 72,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TourGallerySettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TourGallery_tourEventId_key" ON "TourGallery"("tourEventId");

-- CreateIndex
CREATE UNIQUE INDEX "TourMedia_objectKey_key" ON "TourMedia"("objectKey");

-- CreateIndex
CREATE INDEX "TourMedia_galleryId_uploadStatus_deletedAt_idx" ON "TourMedia"("galleryId", "uploadStatus", "deletedAt");

-- CreateIndex
CREATE INDEX "TourMedia_tourEventId_idx" ON "TourMedia"("tourEventId");

-- CreateIndex
CREATE INDEX "TourMedia_uploadStatus_createdAt_idx" ON "TourMedia"("uploadStatus", "createdAt");

-- CreateIndex
CREATE INDEX "TourMedia_batchId_idx" ON "TourMedia"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "TourGalleryLink_token_key" ON "TourGalleryLink"("token");

-- CreateIndex
CREATE INDEX "TourGalleryLink_galleryId_status_idx" ON "TourGalleryLink"("galleryId", "status");

-- CreateIndex
CREATE INDEX "TourGalleryCleanupTask_status_notBefore_idx" ON "TourGalleryCleanupTask"("status", "notBefore");

-- CreateIndex
CREATE INDEX "TourGalleryCleanupTask_tourEventId_status_idx" ON "TourGalleryCleanupTask"("tourEventId", "status");

-- AddForeignKey
ALTER TABLE "TourGallery" ADD CONSTRAINT "TourGallery_tourEventId_fkey" FOREIGN KEY ("tourEventId") REFERENCES "TourEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TourMedia" ADD CONSTRAINT "TourMedia_galleryId_fkey" FOREIGN KEY ("galleryId") REFERENCES "TourGallery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TourGalleryLink" ADD CONSTRAINT "TourGalleryLink_galleryId_fkey" FOREIGN KEY ("galleryId") REFERENCES "TourGallery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

