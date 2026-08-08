-- Media & Content Platform — Part A (galleries) + Part B (content library).
-- docs/architecture/GOS-media-content-platform-audit-2026-08-08.md
--
-- FULLY ADDITIVE. Verified: no DROP TABLE / DROP COLUMN / DROP CONSTRAINT /
-- DELETE / TRUNCATE, and no column is made NOT NULL.
--
-- The three DROP NOT NULL statements are what generalise the proven tour
-- gallery engine into the canonical one. They cannot fail on, or alter, a
-- single existing row: relaxing a constraint always accepts the current data.
--   TourGallery.tourEventId  NULL => a standalone CRM gallery
--   TourMedia.galleryId      NULL => a Content Library asset in no gallery
--   TourMedia.tourEventId    NULL => a non-tour asset (keys.js keeps the
--                                    historical tour prefix for tour assets)
--   TourMedia.objectKey      NULL => an external reference with no R2 object
--
-- Existing tour galleries, their media, and their live public tokens are
-- untouched by this migration.

-- AlterTable
ALTER TABLE "TourGallery" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "defaultLanguage" TEXT,
ADD COLUMN     "extCanDelete" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "extCanDownload" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "extCanEdit" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "extCanUpload" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "extCanView" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "internalName" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active',
ADD COLUMN     "subtitleEn" TEXT,
ADD COLUMN     "subtitleHe" TEXT,
ADD COLUMN     "titleEn" TEXT,
ADD COLUMN     "titleHe" TEXT,
ALTER COLUMN "tourEventId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "TourMedia" ADD COLUMN     "captionEn" TEXT,
ADD COLUMN     "captionHe" TEXT,
ADD COLUMN     "importedAt" TIMESTAMP(3),
ADD COLUMN     "mirroredAt" TIMESTAMP(3),
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sourceExternalId" TEXT,
ADD COLUMN     "sourceMeta" JSONB,
ADD COLUMN     "sourceProvider" TEXT,
ADD COLUMN     "sourcePublishedAt" TIMESTAMP(3),
ADD COLUMN     "sourceThumbnailUrl" TEXT,
ADD COLUMN     "sourceTitle" TEXT,
ADD COLUMN     "sourceUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "sourceUrl" TEXT,
ADD COLUMN     "storageStrategy" TEXT NOT NULL DEFAULT 'r2_native',
ALTER COLUMN "galleryId" DROP NOT NULL,
ALTER COLUMN "tourEventId" DROP NOT NULL,
ALTER COLUMN "objectKey" DROP NOT NULL;

-- AlterTable
ALTER TABLE "TourGalleryLink" ADD COLUMN     "disabledAt" TIMESTAMP(3),
ADD COLUMN     "disabledById" TEXT;

-- CreateTable
CREATE TABLE "GalleryItem" (
    "id" TEXT NOT NULL,
    "galleryId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GalleryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GalleryAudit" (
    "id" TEXT NOT NULL,
    "galleryId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "linkId" TEXT,
    "actorId" TEXT,
    "mediaId" TEXT,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GalleryAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentWorkspace" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentWorkspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentServiceToken" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "canRead" BOOLEAN NOT NULL DEFAULT true,
    "canWrite" BOOLEAN NOT NULL DEFAULT false,
    "canUpload" BOOLEAN NOT NULL DEFAULT false,
    "canTranscribe" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastUsedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ContentServiceToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryCategory" (
    "id" TEXT NOT NULL,
    "nameHe" TEXT NOT NULL,
    "nameEn" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibraryCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryItem" (
    "id" TEXT NOT NULL,
    "internalName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "mediaId" TEXT,
    "description" TEXT,
    "language" TEXT,
    "publicTitleHe" TEXT,
    "publicTitleEn" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibraryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryItemCategory" (
    "itemId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "LibraryItemCategory_pkey" PRIMARY KEY ("itemId","categoryId")
);

-- CreateTable
CREATE TABLE "LibraryItemWorkspace" (
    "itemId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "access" TEXT NOT NULL DEFAULT 'read',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LibraryItemWorkspace_pkey" PRIMARY KEY ("itemId","workspaceId")
);

-- CreateTable
CREATE TABLE "MediaTranscript" (
    "id" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "text" TEXT NOT NULL,
    "segments" JSONB,
    "language" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "sourceObjectKey" TEXT,
    "sourceChecksum" TEXT,
    "durationSeconds" DOUBLE PRECISION,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedById" TEXT,

    CONSTRAINT "MediaTranscript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaJob" (
    "id" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "lastError" TEXT,
    "payload" JSONB,
    "notBefore" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "requestedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaUsage" (
    "id" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "refType" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalSourceConnection" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalSourceConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GalleryItem_galleryId_sortOrder_idx" ON "GalleryItem"("galleryId", "sortOrder");

-- CreateIndex
CREATE INDEX "GalleryItem_mediaId_idx" ON "GalleryItem"("mediaId");

-- CreateIndex
CREATE UNIQUE INDEX "GalleryItem_galleryId_mediaId_key" ON "GalleryItem"("galleryId", "mediaId");

-- CreateIndex
CREATE INDEX "GalleryAudit_galleryId_createdAt_idx" ON "GalleryAudit"("galleryId", "createdAt");

-- CreateIndex
CREATE INDEX "GalleryAudit_action_createdAt_idx" ON "GalleryAudit"("action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContentWorkspace_key_key" ON "ContentWorkspace"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ContentServiceToken_tokenHash_key" ON "ContentServiceToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ContentServiceToken_workspaceId_status_idx" ON "ContentServiceToken"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "LibraryCategory_archived_sortOrder_idx" ON "LibraryCategory"("archived", "sortOrder");

-- CreateIndex
CREATE INDEX "LibraryItem_archived_updatedAt_idx" ON "LibraryItem"("archived", "updatedAt");

-- CreateIndex
CREATE INDEX "LibraryItem_contentType_idx" ON "LibraryItem"("contentType");

-- CreateIndex
CREATE INDEX "LibraryItemCategory_categoryId_idx" ON "LibraryItemCategory"("categoryId");

-- CreateIndex
CREATE INDEX "LibraryItemWorkspace_workspaceId_idx" ON "LibraryItemWorkspace"("workspaceId");

-- CreateIndex
CREATE INDEX "MediaTranscript_mediaId_isCurrent_idx" ON "MediaTranscript"("mediaId", "isCurrent");

-- CreateIndex
CREATE INDEX "MediaJob_status_notBefore_idx" ON "MediaJob"("status", "notBefore");

-- CreateIndex
CREATE INDEX "MediaJob_mediaId_kind_status_idx" ON "MediaJob"("mediaId", "kind", "status");

-- CreateIndex
CREATE INDEX "MediaUsage_refType_refId_idx" ON "MediaUsage"("refType", "refId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaUsage_mediaId_refType_refId_key" ON "MediaUsage"("mediaId", "refType", "refId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalSourceConnection_provider_label_key" ON "ExternalSourceConnection"("provider", "label");

-- CreateIndex
CREATE INDEX "TourGallery_status_updatedAt_idx" ON "TourGallery"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "TourMedia_galleryId_sortOrder_idx" ON "TourMedia"("galleryId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "TourMedia_sourceProvider_sourceExternalId_key" ON "TourMedia"("sourceProvider", "sourceExternalId");

-- AddForeignKey
ALTER TABLE "GalleryItem" ADD CONSTRAINT "GalleryItem_galleryId_fkey" FOREIGN KEY ("galleryId") REFERENCES "TourGallery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GalleryItem" ADD CONSTRAINT "GalleryItem_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "TourMedia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GalleryAudit" ADD CONSTRAINT "GalleryAudit_galleryId_fkey" FOREIGN KEY ("galleryId") REFERENCES "TourGallery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentServiceToken" ADD CONSTRAINT "ContentServiceToken_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ContentWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryItem" ADD CONSTRAINT "LibraryItem_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "TourMedia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryItemCategory" ADD CONSTRAINT "LibraryItemCategory_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "LibraryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryItemCategory" ADD CONSTRAINT "LibraryItemCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "LibraryCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryItemWorkspace" ADD CONSTRAINT "LibraryItemWorkspace_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "LibraryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryItemWorkspace" ADD CONSTRAINT "LibraryItemWorkspace_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "ContentWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaTranscript" ADD CONSTRAINT "MediaTranscript_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "TourMedia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaJob" ADD CONSTRAINT "MediaJob_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "TourMedia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaUsage" ADD CONSTRAINT "MediaUsage_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "TourMedia"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Seed the primary (GOS) content workspace. V1 resolves only this one locally;
-- Challenge/Recruitment become additional rows plus a service token later.
-- Idempotent: re-running the migration on a populated DB is a no-op.
INSERT INTO "ContentWorkspace" ("id", "key", "name", "isPrimary", "active", "createdAt", "updatedAt")
VALUES ('cwsp_gos_primary', 'gos', 'Grafitiyul OS', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
