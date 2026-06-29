-- Deal payment → FK to the CRM catalog (SSOT by ID, never by name/label).
--
-- ADDITIVE, nullable only. Deal now stores paymentTermId / paymentMethodId (FK to
-- PaymentTerm / PaymentMethod, SET NULL on delete). The old free-text columns
-- (paymentTerms / paymentMethod) are kept as DEPRECATED back-compat and are no
-- longer written. Renaming a term/method in settings never affects deals now.
--
-- Defensive (IF NOT EXISTS / guarded constraints) so it is safe to re-run.

ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "paymentTermId" TEXT;
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "paymentMethodId" TEXT;

CREATE INDEX IF NOT EXISTS "Deal_paymentTermId_idx" ON "Deal"("paymentTermId");
CREATE INDEX IF NOT EXISTS "Deal_paymentMethodId_idx" ON "Deal"("paymentMethodId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Deal_paymentTermId_fkey') THEN
    ALTER TABLE "Deal"
      ADD CONSTRAINT "Deal_paymentTermId_fkey"
      FOREIGN KEY ("paymentTermId") REFERENCES "PaymentTerm"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Deal_paymentMethodId_fkey') THEN
    ALTER TABLE "Deal"
      ADD CONSTRAINT "Deal_paymentMethodId_fkey"
      FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
