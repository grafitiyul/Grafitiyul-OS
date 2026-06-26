-- Pricing Slice C — terminology cleanup + default segment bindings.
--
-- DATA ONLY. No tables, columns, or constraints change. Three idempotent steps:
--   1. Ensure the activity-type catalog exists (it is otherwise lazy-seeded by the
--      API on first read). This makes step 3 deterministic regardless of order.
--   2. Rename the user-facing display of the `public` activity type to "קבוצתי"
--      (the internal key stays 'public'; only the editable label changes).
--   3. Pre-seed the three activity-aligned tab → activity-type bindings
--      (group→public, private→private, business→business), ONLY where the tab is
--      still unmapped, so an owner's explicit choice is never overwritten.
-- Nothing here touches business prices, thresholds, Deals, or Quotes.

-- 1. Ensure activity types exist (idempotent by key). New installs get the
--    business-aligned names directly; existing installs already have rows and
--    these inserts no-op.
INSERT INTO "ActivityType" ("id","key","nameHe","nameEn","priceModel","sortOrder","createdAt","updatedAt")
SELECT 'activitytype_public','public','קבוצתי','Group','per_head',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "ActivityType" WHERE "key" = 'public');

INSERT INTO "ActivityType" ("id","key","nameHe","nameEn","priceModel","sortOrder","createdAt","updatedAt")
SELECT 'activitytype_private','private','פרטי','Private','tiered',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "ActivityType" WHERE "key" = 'private');

INSERT INTO "ActivityType" ("id","key","nameHe","nameEn","priceModel","sortOrder","createdAt","updatedAt")
SELECT 'activitytype_business','business','עסקי','Business','tiered',2,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "ActivityType" WHERE "key" = 'business');

-- 2. Rename the legacy 'ציבורי' / 'Public' display to 'קבוצתי' / 'Group'. Guarded
--    on the old value so a later owner rename is not clobbered if this re-runs.
UPDATE "ActivityType" SET "nameHe" = 'קבוצתי'
WHERE "key" = 'public' AND "nameHe" = 'ציבורי';
UPDATE "ActivityType" SET "nameEn" = 'Group'
WHERE "key" = 'public' AND "nameEn" = 'Public';

-- 3. Pre-seed default tab bindings, only for still-unmapped tabs.
UPDATE "PricingSegment" s
SET "activityTypeId" = a."id"
FROM "ActivityType" a
WHERE s."activityTypeId" IS NULL
  AND (
    (s."key" = 'group'    AND a."key" = 'public')   OR
    (s."key" = 'private'  AND a."key" = 'private')  OR
    (s."key" = 'business' AND a."key" = 'business')
  );
