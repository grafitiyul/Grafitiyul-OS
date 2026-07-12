-- Tour lifecycle fix (reopen→re-WON twins): loose marker for TourEvent rows
-- that were erroneously replaced by a newer row for the same deal. Additive
-- and nullable — safe on a live database. Superseded rows are hidden from all
-- list/calendar views; backfill of the historical twins runs separately via
-- the guarded scripts/backfill-superseded-tours.mjs (never automatic).
ALTER TABLE "TourEvent" ADD COLUMN "supersededByTourEventId" TEXT;
