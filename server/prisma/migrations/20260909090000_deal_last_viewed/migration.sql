-- Deal view tracking (2026-07-30) — deliberately SEPARATE from
-- lastMeaningfulActivityAt: opening a deal is operational context, not
-- business activity, and must never reorder the CRM list. Written by a raw
-- UPDATE on the detail read so it cannot bump the row's `updatedAt`.
-- Loose actor key (no FK), same convention as EmailMessage.createdByUserId.
ALTER TABLE "Deal" ADD COLUMN "lastViewedAt" TIMESTAMP(3);
ALTER TABLE "Deal" ADD COLUMN "lastViewedById" TEXT;
ALTER TABLE "Deal" ADD COLUMN "lastViewedByName" TEXT;
