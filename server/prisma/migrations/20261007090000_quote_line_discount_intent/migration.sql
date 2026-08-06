-- Per-line discount intent (percent OR fixed builder-basis minor amount, at
-- most one set); the resolved money stays a materialized discount row.
-- Additive + nullable — no backfill, no data change.
ALTER TABLE "QuoteLine"
  ADD COLUMN "discountPercent" DOUBLE PRECISION,
  ADD COLUMN "discountFixedMinor" BIGINT;
