-- Timeline author display-name snapshot.
--
-- ADDITIVE ONLY. Adds "createdByName" (a snapshot of the author's username at
-- creation) alongside the existing "createdBy" (AdminUser.id) on both timeline
-- tables. Lets the feed render the author with no join, resilient to renames /
-- deactivation. Defensive (IF NOT EXISTS) so it is safe to re-run.

ALTER TABLE "TimelineEntry"   ADD COLUMN IF NOT EXISTS "createdByName" TEXT;
ALTER TABLE "TimelineComment" ADD COLUMN IF NOT EXISTS "createdByName" TEXT;
