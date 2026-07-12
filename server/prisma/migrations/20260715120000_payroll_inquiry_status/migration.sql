-- Canonical inquiry state, separate from guide approval. Additive columns +
-- safe backfill: entries whose guideStatus was the legacy 'inquiry' value
-- become inquiryStatus='open' with guideStatus back to 'pending' — from now
-- on guideStatus is strictly pending|approved.
ALTER TABLE "PayrollEntry" ADD COLUMN "inquiryStatus" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "PayrollEntry" ADD COLUMN "inquiryResolvedAt" TIMESTAMP(3);
ALTER TABLE "PayrollEntry" ADD COLUMN "inquiryResolvedBy" TEXT;

UPDATE "PayrollEntry"
SET "inquiryStatus" = 'open', "guideStatus" = 'pending'
WHERE "guideStatus" = 'inquiry';
