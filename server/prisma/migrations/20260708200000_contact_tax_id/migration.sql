-- Contact.taxId — ת.ז / ע.מ for private-customer accounting documents.
-- ADDITIVE only (nullable column, no data migration). Written back from the
-- הפק מסמך modal so the next document is prefilled; org-level ח.פ stays on
-- Organization/OrganizationUnit.taxId.
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "taxId" TEXT;
