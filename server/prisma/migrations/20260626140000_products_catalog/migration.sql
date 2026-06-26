-- CreateTable
CREATE TABLE "MediaFile" (
    "id" TEXT NOT NULL,
    "r2Key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "kind" TEXT NOT NULL DEFAULT 'image',
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "nameHe" TEXT NOT NULL,
    "nameEn" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "nameHe" TEXT NOT NULL,
    "nameEn" TEXT,
    "marketingDescHe" TEXT,
    "marketingDescEn" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "marketingDescHe" TEXT,
    "marketingDescEn" TEXT,
    "guideDescHe" TEXT,
    "guideDescEn" TEXT,
    "durationHours" DOUBLE PRECISION,
    "meetingPointHe" TEXT,
    "meetingPointEn" TEXT,
    "endingPointHe" TEXT,
    "endingPointEn" TEXT,
    "meetingPointImageId" TEXT,
    "baseGuidePaymentMinor" BIGINT NOT NULL DEFAULT 0,
    "travelPaymentMinor" BIGINT,
    "currency" TEXT NOT NULL DEFAULT 'ILS',
    "availablePublic" BOOLEAN NOT NULL DEFAULT true,
    "availablePrivate" BOOLEAN NOT NULL DEFAULT true,
    "availableBusiness" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariantImage" (
    "id" TEXT NOT NULL,
    "productVariantId" TEXT NOT NULL,
    "mediaFileId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductVariantImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityType" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nameHe" TEXT NOT NULL,
    "nameEn" TEXT,
    "priceModel" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentTerm" (
    "id" TEXT NOT NULL,
    "nameHe" TEXT NOT NULL,
    "nameEn" TEXT,
    "defaultPaymentMethodId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMethod" (
    "id" TEXT NOT NULL,
    "nameHe" TEXT NOT NULL,
    "nameEn" TEXT,
    "defaultPaymentTermId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaFile_r2Key_key" ON "MediaFile"("r2Key");

-- CreateIndex
CREATE INDEX "Location_sortOrder_idx" ON "Location"("sortOrder");

-- CreateIndex
CREATE INDEX "Product_sortOrder_idx" ON "Product"("sortOrder");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant"("productId");

-- CreateIndex
CREATE INDEX "ProductVariant_locationId_idx" ON "ProductVariant"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_productId_locationId_key" ON "ProductVariant"("productId", "locationId");

-- CreateIndex
CREATE INDEX "ProductVariantImage_productVariantId_idx" ON "ProductVariantImage"("productVariantId");

-- CreateIndex
CREATE INDEX "ProductVariantImage_mediaFileId_idx" ON "ProductVariantImage"("mediaFileId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityType_key_key" ON "ActivityType"("key");

-- CreateIndex
CREATE INDEX "PaymentTerm_sortOrder_idx" ON "PaymentTerm"("sortOrder");

-- CreateIndex
CREATE INDEX "PaymentMethod_sortOrder_idx" ON "PaymentMethod"("sortOrder");

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_meetingPointImageId_fkey" FOREIGN KEY ("meetingPointImageId") REFERENCES "MediaFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariantImage" ADD CONSTRAINT "ProductVariantImage_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariantImage" ADD CONSTRAINT "ProductVariantImage_mediaFileId_fkey" FOREIGN KEY ("mediaFileId") REFERENCES "MediaFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTerm" ADD CONSTRAINT "PaymentTerm_defaultPaymentMethodId_fkey" FOREIGN KEY ("defaultPaymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_defaultPaymentTermId_fkey" FOREIGN KEY ("defaultPaymentTermId") REFERENCES "PaymentTerm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

