-- Deal ↔ Organization classification sync — DATA REPAIR ONLY (no schema change).
--
-- New business rule (enforced by the API from this release on — see
-- server/src/deals/classification.js): a linked Organization is the source of
-- truth for the deal's classification.
--   • linked org  ⇒ activityType = 'business'
--   • linked org  ⇒ Deal.organizationTypeId is NULL (the ORG's own type is the
--                   single effective type; no contradicting copy on the deal)
--   • the deal's subtype must belong to the org's type (generic, type-less
--                   subtypes are always fine)
--
-- This migration repairs rows written under the old rules so no deal is left
-- displaying/persisting a classification that contradicts its organization.
-- Idempotent and safe to re-run: every UPDATE only touches contradicting rows.

-- 1) Org-linked deals that are not business → business.
UPDATE "Deal"
SET "activityType" = 'business'
WHERE "organizationId" IS NOT NULL
  AND ("activityType" IS DISTINCT FROM 'business');

-- 2) Org-linked deals holding a deal-level org-type copy → clear it (the
--    organization's own type becomes the effective type everywhere).
UPDATE "Deal"
SET "organizationTypeId" = NULL
WHERE "organizationId" IS NOT NULL
  AND "organizationTypeId" IS NOT NULL;

-- 3) Org-linked deals whose subtype belongs to a DIFFERENT type than the
--    organization's → clear the subtype (type-less/generic subtypes are kept).
UPDATE "Deal" d
SET "organizationSubtypeId" = NULL
FROM "Organization" o, "OrganizationSubtype" s
WHERE d."organizationId" = o."id"
  AND d."organizationSubtypeId" = s."id"
  AND s."organizationTypeId" IS NOT NULL
  AND s."organizationTypeId" IS DISTINCT FROM o."organizationTypeId";
