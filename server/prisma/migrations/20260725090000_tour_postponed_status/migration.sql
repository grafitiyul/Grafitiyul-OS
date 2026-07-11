-- Postponed tours ("נדחה"): the Deal removed the applied tour date without a
-- replacement. The SAME TourEvent transitions scheduled → postponed with
-- date/startTime cleared (team/components/notes/questionnaires/gallery all
-- preserved), and back to scheduled when a new date is applied. Widening the
-- two columns to nullable is additive-safe: no existing values change, and no
-- existing row is reclassified.
ALTER TABLE "TourEvent" ALTER COLUMN "date" DROP NOT NULL;
ALTER TABLE "TourEvent" ALTER COLUMN "startTime" DROP NOT NULL;
