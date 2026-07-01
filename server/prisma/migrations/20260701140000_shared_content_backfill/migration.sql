-- Shared Content Library — Slice 2: conservative data backfill.
--
-- Relocates EXISTING meeting/ending point content into SharedContent rows +
-- variant links. Strictly conservative:
--   * NO auto-deduplication — one row per source (variants that share a physical
--     place are NOT merged; humans merge later via the library UI).
--   * NO merging of similar content.
--   * OLD COLUMNS ARE NOT TOUCHED — dual-read keeps them as the fallback until a
--     later (Slice 5) cleanup migration removes them.
-- Additive + idempotent: each INSERT guards against a row it already created, so
-- a re-run is a no-op. Ids use gen_random_uuid()::text (core Postgres ≥13); app
-- rows use cuid, but a text PK is format-agnostic.

-- 1) Location meeting point → the location's DEFAULT meeting_point block. This
--    makes today's silent "variant → location" fallback an explicit, editable,
--    reference-counted default.
INSERT INTO "SharedContent"
  (id, type, "internalName", "bodyHe", "bodyEn", "imageId", "locationId", "isLocationDefault", active, "sortOrder", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  'meeting_point',
  COALESCE(NULLIF(l."nameHe", ''), 'מיקום') || ' — נקודת מפגש (ברירת מחדל)',
  l."meetingPointHe",
  l."meetingPointEn",
  l."meetingPointImageId",
  l.id,
  true,
  0,
  now(),
  now()
FROM "Location" l
WHERE (
     (l."meetingPointHe" IS NOT NULL AND l."meetingPointHe" <> '')
  OR (l."meetingPointEn" IS NOT NULL AND l."meetingPointEn" <> '')
  OR l."meetingPointImageId" IS NOT NULL
)
AND NOT EXISTS (
  SELECT 1 FROM "SharedContent" sc
  WHERE sc."locationId" = l.id AND sc.type = 'meeting_point' AND sc."isLocationDefault" = true
);

-- 2) ProductVariant meeting point → its OWN meeting_point block + a variant link.
--    Variants whose meeting point was empty are intentionally left unlinked: they
--    keep resolving to the location default from step 1 (sharing preserved, no
--    duplication introduced).
-- MATERIALIZED is REQUIRED: `src` is consumed by two statements and holds a
-- VOLATILE gen_random_uuid(); without it the optimizer could inline `src` and
-- re-evaluate the id differently per consumer, breaking the SC↔link FK. Forcing
-- materialization computes each id exactly once.
WITH src AS MATERIALIZED (
  SELECT
    v.id            AS variant_id,
    gen_random_uuid()::text AS sc_id,
    v."meetingPointHe"      AS he,
    v."meetingPointEn"      AS en,
    v."meetingPointImageId" AS img,
    v."locationId"          AS loc_id,
    p."nameHe"              AS pname,
    l."nameHe"             AS lname
  FROM "ProductVariant" v
  JOIN "Product" p  ON p.id = v."productId"
  JOIN "Location" l ON l.id = v."locationId"
  WHERE (
       (v."meetingPointHe" IS NOT NULL AND v."meetingPointHe" <> '')
    OR (v."meetingPointEn" IS NOT NULL AND v."meetingPointEn" <> '')
    OR v."meetingPointImageId" IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "ProductVariantSharedContent" pvsc
    JOIN "SharedContent" sc ON sc.id = pvsc."sharedContentId"
    WHERE pvsc."productVariantId" = v.id AND sc.type = 'meeting_point'
  )
),
ins_sc AS (
  INSERT INTO "SharedContent"
    (id, type, "internalName", "bodyHe", "bodyEn", "imageId", "locationId", "isLocationDefault", active, "sortOrder", "createdAt", "updatedAt")
  SELECT
    sc_id,
    'meeting_point',
    COALESCE(NULLIF(pname, ''), 'מוצר') || ' / ' || COALESCE(NULLIF(lname, ''), 'מיקום') || ' — נקודת מפגש',
    he, en, img, loc_id, false, 0, now(), now()
  FROM src
  RETURNING id
)
INSERT INTO "ProductVariantSharedContent" (id, "productVariantId", "sharedContentId", "sortOrder")
SELECT gen_random_uuid()::text, variant_id, sc_id, 0 FROM src;

-- 3) ProductVariant ending point → its OWN ending_point block + a variant link.
--    No location-level ending point exists today, so there is no default step.
--    MATERIALIZED for the same id-stability reason as step 2.
WITH src AS MATERIALIZED (
  SELECT
    v.id            AS variant_id,
    gen_random_uuid()::text AS sc_id,
    v."endingPointHe"       AS he,
    v."endingPointEn"       AS en,
    v."locationId"          AS loc_id,
    p."nameHe"              AS pname,
    l."nameHe"             AS lname
  FROM "ProductVariant" v
  JOIN "Product" p  ON p.id = v."productId"
  JOIN "Location" l ON l.id = v."locationId"
  WHERE (
       (v."endingPointHe" IS NOT NULL AND v."endingPointHe" <> '')
    OR (v."endingPointEn" IS NOT NULL AND v."endingPointEn" <> '')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "ProductVariantSharedContent" pvsc
    JOIN "SharedContent" sc ON sc.id = pvsc."sharedContentId"
    WHERE pvsc."productVariantId" = v.id AND sc.type = 'ending_point'
  )
),
ins_sc AS (
  INSERT INTO "SharedContent"
    (id, type, "internalName", "bodyHe", "bodyEn", "locationId", "isLocationDefault", active, "sortOrder", "createdAt", "updatedAt")
  SELECT
    sc_id,
    'ending_point',
    COALESCE(NULLIF(pname, ''), 'מוצר') || ' / ' || COALESCE(NULLIF(lname, ''), 'מיקום') || ' — נקודת סיום',
    he, en, loc_id, false, 0, now(), now()
  FROM src
  RETURNING id
)
INSERT INTO "ProductVariantSharedContent" (id, "productVariantId", "sharedContentId", "sortOrder")
SELECT gen_random_uuid()::text, variant_id, sc_id, 0 FROM src;
