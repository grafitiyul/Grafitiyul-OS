-- Guide Portal — English content fields.
--
-- ADDITIVE ONLY. Every column is nullable, no existing column is renamed,
-- dropped or rewritten, and NO Hebrew value is copied into an English column:
-- an empty English column means "no English content written yet", which is
-- exactly what scripts/report-portal-english-gaps.mjs reports on. Nothing here
-- machine-translates anything.
--
-- The unsuffixed columns on WorkshopLocation (address, instructions) and Flow
-- (title, description) are the Hebrew side; they are deliberately NOT renamed
-- so this migration cannot break a running deploy.

-- Workshop locations — where the guide goes and how to get in.
ALTER TABLE "WorkshopLocation" ADD COLUMN IF NOT EXISTS "nameEn" TEXT;
ALTER TABLE "WorkshopLocation" ADD COLUMN IF NOT EXISTS "addressEn" TEXT;
ALTER TABLE "WorkshopLocation" ADD COLUMN IF NOT EXISTS "instructionsEn" TEXT;

-- Training content (Tour → Station → ContentBlock → BlockAsset).
ALTER TABLE "Tour" ADD COLUMN IF NOT EXISTS "titleEn" TEXT;
ALTER TABLE "Tour" ADD COLUMN IF NOT EXISTS "descriptionEn" TEXT;

ALTER TABLE "TourStation" ADD COLUMN IF NOT EXISTS "titleEn" TEXT;
ALTER TABLE "TourStation" ADD COLUMN IF NOT EXISTS "descriptionEn" TEXT;
ALTER TABLE "TourStation" ADD COLUMN IF NOT EXISTS "heroImageTitleEn" TEXT;

ALTER TABLE "TourContentBlock" ADD COLUMN IF NOT EXISTS "titleEn" TEXT;
ALTER TABLE "TourContentBlock" ADD COLUMN IF NOT EXISTS "bodyEn" TEXT;

ALTER TABLE "TourBlockAsset" ADD COLUMN IF NOT EXISTS "titleEn" TEXT;

-- Payroll catalog + the display snapshots the guide portal renders.
ALTER TABLE "PayrollComponent" ADD COLUMN IF NOT EXISTS "nameEn" TEXT;

ALTER TABLE "GeneralActivityType" ADD COLUMN IF NOT EXISTS "nameEn" TEXT;
ALTER TABLE "GeneralActivityType" ADD COLUMN IF NOT EXISTS "unitLabelSingularEn" TEXT;
ALTER TABLE "GeneralActivityType" ADD COLUMN IF NOT EXISTS "unitLabelPluralEn" TEXT;

ALTER TABLE "GeneralActivity" ADD COLUMN IF NOT EXISTS "titleEn" TEXT;

ALTER TABLE "PayrollActivity" ADD COLUMN IF NOT EXISTS "titleEn" TEXT;

-- Procedures.
ALTER TABLE "Flow" ADD COLUMN IF NOT EXISTS "titleEn" TEXT;
ALTER TABLE "Flow" ADD COLUMN IF NOT EXISTS "descriptionEn" TEXT;
