-- Avatar recrop support on PersonProfile: keep the untouched original upload
-- and the crop metadata that produced the canonical avatar (imageUrl), so a
-- later recrop re-reads the original instead of forcing a new upload.

-- AlterTable
ALTER TABLE "PersonProfile" ADD COLUMN "imageOriginalUrl" TEXT,
ADD COLUMN "imageCrop" JSONB;
