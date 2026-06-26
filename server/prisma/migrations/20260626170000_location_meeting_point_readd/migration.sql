-- Re-introduce Location meeting-point fields (text + R2 image).
--
-- IDEMPOTENT BY DESIGN. The original migration (20260626160000) was reverted
-- in git, but a git revert never un-applies SQL from the database. We cannot
-- assume whether the target DB already has these columns/constraint, so every
-- statement here is safe whether or not they already exist:
--   * ADD COLUMN IF NOT EXISTS  → no-op if the column is already there
--   * FK added inside a guard    → only added if the constraint is missing
-- All additive and nullable; nothing is dropped or rewritten.

ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "meetingPointHe" TEXT;
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "meetingPointEn" TEXT;
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "meetingPointImageId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Location_meetingPointImageId_fkey'
  ) THEN
    ALTER TABLE "Location"
      ADD CONSTRAINT "Location_meetingPointImageId_fkey"
      FOREIGN KEY ("meetingPointImageId") REFERENCES "MediaFile"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
