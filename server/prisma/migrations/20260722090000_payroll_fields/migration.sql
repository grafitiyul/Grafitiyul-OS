-- Admin-only payroll facts on PersonProfile: VAT status ('exempt'|'vat_18',
-- validated in the route) and a plain-decimal seniority supplement. Both are
-- tracked in the person changelog and structurally excluded from every guide
-- portal payload.

-- AlterTable
ALTER TABLE "PersonProfile" ADD COLUMN "vatStatus" TEXT,
ADD COLUMN "senioritySupplement" DECIMAL(10,2);
