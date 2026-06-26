-- Add quote-content fields to organization classification.
--
-- ADDITIVE ONLY. Four new nullable rich-HTML columns. This content is owned by
-- the organization type/subtype and will LATER be inserted into quotes by the
-- selected type/subtype. NOT wired to Quotes here. Defensive (IF NOT EXISTS) so
-- it is safe to run once and harmless if a column already exists.

ALTER TABLE "OrganizationType" ADD COLUMN IF NOT EXISTS "quoteContentHe" TEXT;
ALTER TABLE "OrganizationType" ADD COLUMN IF NOT EXISTS "quoteContentEn" TEXT;
ALTER TABLE "OrganizationSubtype" ADD COLUMN IF NOT EXISTS "quoteContentHe" TEXT;
ALTER TABLE "OrganizationSubtype" ADD COLUMN IF NOT EXISTS "quoteContentEn" TEXT;
