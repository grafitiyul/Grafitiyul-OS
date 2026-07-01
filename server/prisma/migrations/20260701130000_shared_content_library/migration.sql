-- Shared Content Library — platform-wide reusable content (Slice 1: foundation).
--
-- ADDITIVE ONLY. Two new tables; no existing table or column is touched, and NO
-- data is moved in this migration. The data backfill (relocating the current
-- Location / ProductVariant meeting-point + ending-point fields into SharedContent
-- rows) is a SEPARATE, idempotent, reviewable step (next slice) so it can generate
-- real cuids and be re-run safely. Runtime behaviour is unchanged after this
-- migration — nothing reads these tables yet.

-- CreateTable
CREATE TABLE "SharedContent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "internalName" TEXT NOT NULL,
    "description" TEXT,
    "bodyHe" TEXT,
    "bodyEn" TEXT,
    "imageId" TEXT,
    "mapUrl" TEXT,
    "locationId" TEXT,
    "isLocationDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SharedContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariantSharedContent" (
    "id" TEXT NOT NULL,
    "productVariantId" TEXT NOT NULL,
    "sharedContentId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductVariantSharedContent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SharedContent_type_idx" ON "SharedContent"("type");

-- CreateIndex
CREATE INDEX "SharedContent_locationId_idx" ON "SharedContent"("locationId");

-- CreateIndex
CREATE INDEX "SharedContent_locationId_type_idx" ON "SharedContent"("locationId", "type");

-- CreateIndex
CREATE INDEX "SharedContent_active_sortOrder_idx" ON "SharedContent"("active", "sortOrder");

-- CreateIndex
CREATE INDEX "ProductVariantSharedContent_productVariantId_idx" ON "ProductVariantSharedContent"("productVariantId");

-- CreateIndex
CREATE INDEX "ProductVariantSharedContent_sharedContentId_idx" ON "ProductVariantSharedContent"("sharedContentId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariantSharedContent_productVariantId_sharedContentId_key" ON "ProductVariantSharedContent"("productVariantId", "sharedContentId");

-- AddForeignKey
ALTER TABLE "SharedContent" ADD CONSTRAINT "SharedContent_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "MediaFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedContent" ADD CONSTRAINT "SharedContent_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariantSharedContent" ADD CONSTRAINT "ProductVariantSharedContent_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariantSharedContent" ADD CONSTRAINT "ProductVariantSharedContent_sharedContentId_fkey" FOREIGN KEY ("sharedContentId") REFERENCES "SharedContent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
