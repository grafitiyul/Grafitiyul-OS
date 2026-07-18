-- Pricing options slice: org-default associations, operational groups, card pin.
--
-- ADDITIVE ONLY. Four nullable/defaulted columns, no data rewrites. Idempotent.
--
-- 1. Deal.groups — canonical OPERATIONAL group count of the tour (lives beside
--    tourDate/tourTime/participants, the deal's operational scalars). NULL = 1.
--    Pricing CONSUMES it; there is deliberately no pricing-specific copy.
-- 2. PriceRule.defaultOrgTypeIds / defaultOrgSubtypeIds — the Pricing Card's
--    many-to-many DEFAULT association (one card may be the default for several
--    organization types/subtypes). Card-level values duplicated across sibling
--    rules like cardSortOrder/firstLineNote; empty = neutral card. Loose ids by
--    design (same convention as cardGroupId) — association is default-selection
--    preference, never a hard scope.
-- 3. QuoteLine.pinnedCardGroupId — the operator's INTENTIONAL Pricing Card
--    selection for this line (input to resolution). Distinct from
--    sourceCardGroupId, which records which card actually priced the line
--    (output provenance).

ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "groups" INTEGER;
ALTER TABLE "PriceRule" ADD COLUMN IF NOT EXISTS "defaultOrgTypeIds" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "PriceRule" ADD COLUMN IF NOT EXISTS "defaultOrgSubtypeIds" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "QuoteLine" ADD COLUMN IF NOT EXISTS "pinnedCardGroupId" TEXT;
