-- Deal-level Builder discount intent (summary row): percent OR fixed minor
-- amount, at most one set. Additive + nullable — no backfill, no data change.
ALTER TABLE "QuoteVersion"
  ADD COLUMN "dealDiscountPercent" DOUBLE PRECISION,
  ADD COLUMN "dealDiscountFixedMinor" BIGINT;
