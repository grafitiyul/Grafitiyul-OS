-- Collection work queue — an OPERATIONAL field, not an accounting one.
--
-- The Collection screen listed every WON deal whose money had not fully
-- arrived: 3,250 rows, most of them historical migrations nobody intends to
-- chase. That is a report, not a work queue. This field records the business
-- decision of whether a deal still needs collection WORK today.
--
-- Nothing about the accounting changes: computeCollection() is untouched and
-- remains the only source of paid / balance / status, and no amount, document
-- or allocation is affected by this migration.
--
-- All columns nullable and additive; existing rows are untouched until the
-- classification script runs (which only ever fills NULLs).

ALTER TABLE "Deal"
  ADD COLUMN "collectionReviewStatus"       TEXT,
  ADD COLUMN "collectionReviewStatusSource" TEXT,
  ADD COLUMN "collectionReviewStatusAt"     TIMESTAMP(3),
  ADD COLUMN "collectionReviewStatusBy"     TEXT;

-- Serves the work queue's default view (status='won' + review status).
CREATE INDEX "Deal_status_collectionReviewStatus_idx" ON "Deal"("status", "collectionReviewStatus");
