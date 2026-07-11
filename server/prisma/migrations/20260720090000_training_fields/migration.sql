-- Staff training onboarding facts on PersonProfile: official training start
-- date ("YYYY-MM-DD") and the cohort label (free text). Management-owned,
-- surfaced on the staff list and profile header; changes are recorded in the
-- person changelog.

-- AlterTable
ALTER TABLE "PersonProfile" ADD COLUMN "trainingStartDate" TEXT,
ADD COLUMN "trainingCohort" TEXT;
