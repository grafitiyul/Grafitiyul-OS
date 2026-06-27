-- Default payment terms/method per Organization Type.
--
-- ADDITIVE ONLY. Three new nullable columns on OrganizationType plus two FKs
-- that REFERENCE the existing Payment Configuration catalog (PaymentTerm /
-- PaymentMethod) — no catalog is duplicated. `defaultPaymentMethodId` is an
-- optional OVERRIDE: null means the effective method is inherited from the
-- chosen term's own default. NOT wired to Quotes/Deals/invoices. Defensive
-- (IF NOT EXISTS + guarded constraints) so it is safe to re-run.

ALTER TABLE "OrganizationType" ADD COLUMN IF NOT EXISTS "defaultPaymentTermId" TEXT;
ALTER TABLE "OrganizationType" ADD COLUMN IF NOT EXISTS "defaultPaymentMethodId" TEXT;
ALTER TABLE "OrganizationType" ADD COLUMN IF NOT EXISTS "paymentTermsNote" TEXT;

CREATE INDEX IF NOT EXISTS "OrganizationType_defaultPaymentTermId_idx" ON "OrganizationType"("defaultPaymentTermId");
CREATE INDEX IF NOT EXISTS "OrganizationType_defaultPaymentMethodId_idx" ON "OrganizationType"("defaultPaymentMethodId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrganizationType_defaultPaymentTermId_fkey') THEN
    ALTER TABLE "OrganizationType" ADD CONSTRAINT "OrganizationType_defaultPaymentTermId_fkey" FOREIGN KEY ("defaultPaymentTermId") REFERENCES "PaymentTerm"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrganizationType_defaultPaymentMethodId_fkey') THEN
    ALTER TABLE "OrganizationType" ADD CONSTRAINT "OrganizationType_defaultPaymentMethodId_fkey" FOREIGN KEY ("defaultPaymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
