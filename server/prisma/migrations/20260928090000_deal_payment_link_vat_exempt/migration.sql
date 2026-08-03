-- DealPaymentLink.vatExempt: records that the sale behind this iCount link was
-- generated as VAT-exempt (working Builder resolved exempt — pricing/dealVat.js).
-- Part of the link snapshot: a Builder VAT-mode change now drifts the snapshot
-- and regenerates the link on next open. Existing rows were all generated on
-- the VAT-inclusive paypage → false.
ALTER TABLE "DealPaymentLink" ADD COLUMN "vatExempt" BOOLEAN NOT NULL DEFAULT false;
