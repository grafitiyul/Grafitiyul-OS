-- Selective office approval: the approval truth moves from PayrollActivity
-- to PayrollEntry (officeStatus per entry). Purely additive columns + a safe
-- backfill; PayrollActivity.status/officeApprovedAt/officeApprovedBy stay in
-- place but are DEPRECATED (frozen — code neither reads nor writes them).
ALTER TABLE "PayrollEntry" ADD COLUMN "officeStatus" TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE "PayrollEntry" ADD COLUMN "officeApprovedAt" TIMESTAMP(3);
ALTER TABLE "PayrollEntry" ADD COLUMN "officeApprovedBy" TEXT;

-- Backfill: every ACTIVE entry of an office-approved activity becomes
-- office-approved with the activity's original stamp — no guide-visible
-- payroll disappears. Draft activities keep their entries draft (default).
UPDATE "PayrollEntry" AS e
SET "officeStatus" = 'approved',
    "officeApprovedAt" = a."officeApprovedAt",
    "officeApprovedBy" = a."officeApprovedBy"
FROM "PayrollActivity" AS a
WHERE e."activityId" = a."id"
  AND a."status" = 'office_approved'
  AND e."state" = 'active';
