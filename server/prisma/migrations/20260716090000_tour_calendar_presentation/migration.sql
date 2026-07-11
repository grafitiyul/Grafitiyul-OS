-- Presentation-field ownership for the tour calendar mirror: remember what
-- GOS last wrote for title/description/color so manual edits made directly in
-- Google Calendar are detected (current != last-written) and preserved, while
-- untouched fields keep following the derived defaults.

-- AlterTable
ALTER TABLE "TourEvent" ADD COLUMN "gcalLastSummary" TEXT,
ADD COLUMN "gcalLastDescription" TEXT,
ADD COLUMN "gcalLastColorId" TEXT;
