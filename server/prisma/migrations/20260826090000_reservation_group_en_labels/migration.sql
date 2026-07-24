-- EN display-label snapshots on reservation groups (form-snapshot PDF parity).
--
-- The group already freezes the Hebrew commercial labels the agent saw
-- (productLabel/locationLabel); an ENGLISH-form agent sees the catalog's EN
-- labels (falling back to the Hebrew commercial names). Freezing both lets the
-- EN summary document mirror the EN form exactly — never re-resolved from the
-- live catalog. Additive, nullable; legacy rows keep rendering the HE labels.
ALTER TABLE "ReservationGroup" ADD COLUMN "productLabelEn" TEXT;
ALTER TABLE "ReservationGroup" ADD COLUMN "locationLabelEn" TEXT;
