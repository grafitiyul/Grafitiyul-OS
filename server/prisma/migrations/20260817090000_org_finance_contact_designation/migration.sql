-- Finance contact becomes a REAL canonical Contact: Organization gains a
-- financeContactId designation (exactly one current finance contact). The
-- legacy name/phone/email scalars stay as a service-owned display mirror.
-- Purely additive; the data backfill (scalars -> canonical Contacts, with
-- phone/email identity matching) runs as the durable one-time maintenance job
-- migrate_org_finance_contacts_v1, which needs full JS phone normalization.
ALTER TABLE "Organization" ADD COLUMN "financeContactId" TEXT;
CREATE INDEX IF NOT EXISTS "Organization_financeContactId_idx" ON "Organization"("financeContactId");
ALTER TABLE "Organization"
  ADD CONSTRAINT "Organization_financeContactId_fkey"
  FOREIGN KEY ("financeContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
