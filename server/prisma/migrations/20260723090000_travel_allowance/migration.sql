-- "נסיעות" — admin-only payroll fact on PersonProfile, same plain-decimal
-- convention as senioritySupplement. Changelog-tracked, restorable, and
-- structurally excluded from every guide portal payload.

-- AlterTable
ALTER TABLE "PersonProfile" ADD COLUMN "travelAllowance" DECIMAL(10,2);
