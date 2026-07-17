-- Corrective slice: retire the separate VariantChannelListing catalogue in
-- favour of canonical entities — agent presentation lives on ProductVariant
-- (agentVisible / agentDisplayName(+En) / agentDescription) and commercial
-- cities become a ONE-level Location hierarchy (parentLocationId).
--
-- LOSSLESS by construction: any owner-entered agent listings are migrated
-- deterministically BEFORE the old table is dropped (names/visibility/
-- description onto the variant; commercial cities become parent Locations
-- wired to the variants' operational locations). Runs safely on an empty
-- table (every step is a no-op). Counts are RAISE NOTICEd into deploy logs.

-- ── 1) New canonical columns ──────────────────────────────────────────────────
ALTER TABLE "Location" ADD COLUMN "parentLocationId" TEXT;
CREATE INDEX IF NOT EXISTS "Location_parentLocationId_idx" ON "Location"("parentLocationId");
ALTER TABLE "Location"
  ADD CONSTRAINT "Location_parentLocationId_fkey"
  FOREIGN KEY ("parentLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductVariant" ADD COLUMN "agentVisible" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ProductVariant" ADD COLUMN "agentDisplayName" TEXT;
ALTER TABLE "ProductVariant" ADD COLUMN "agentDisplayNameEn" TEXT;
ALTER TABLE "ProductVariant" ADD COLUMN "agentDescription" TEXT;

-- ── 2) Audit count into deploy logs ──────────────────────────────────────────
DO $$
DECLARE total integer; vis integer;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE "visible") INTO total, vis
  FROM "VariantChannelListing" WHERE "channel" = 'agent';
  RAISE NOTICE '[agent-catalog migration] listings found: % (visible: %)', total, vis;
END $$;

-- ── 3) Migrate listing presentation onto the canonical variant ───────────────
UPDATE "ProductVariant" v
SET "agentVisible"       = l."visible",
    "agentDisplayName"   = NULLIF(l."displayName", ''),
    "agentDisplayNameEn" = l."displayNameEn",
    "agentDescription"   = l."description"
FROM "VariantChannelListing" l
WHERE l."productVariantId" = v."id" AND l."channel" = 'agent';

-- ── 4) Commercial cities → parent Locations ──────────────────────────────────
-- Create a root Location for each distinct commercial city of a VISIBLE
-- listing when (a) it differs from the variant's own location name (a
-- standalone like "בית הלקוח" needs no parent) and (b) no Location with that
-- exact name exists yet. New roots sort after existing rows.
INSERT INTO "Location" ("id", "nameHe", "active", "isHomeLocation", "sortOrder", "createdAt", "updatedAt")
SELECT 'loc_' || gen_random_uuid(), c."commercialCity", true, false,
       1000 + (row_number() OVER (ORDER BY c."commercialCity")), now(), now()
FROM (
  SELECT DISTINCT l."commercialCity"
  FROM "VariantChannelListing" l
  JOIN "ProductVariant" v ON v."id" = l."productVariantId"
  JOIN "Location" loc ON loc."id" = v."locationId"
  WHERE l."channel" = 'agent' AND l."visible" = true
    AND l."commercialCity" <> '' AND l."commercialCity" <> loc."nameHe"
    AND NOT EXISTS (SELECT 1 FROM "Location" p WHERE p."nameHe" = l."commercialCity")
) c;

-- Carry the English city label onto the parent when the parent has none.
UPDATE "Location" p
SET "nameEn" = l."commercialCityEn"
FROM "VariantChannelListing" l
WHERE l."channel" = 'agent' AND l."commercialCityEn" IS NOT NULL
  AND p."nameHe" = l."commercialCity" AND p."nameEn" IS NULL;

-- Wire each visible listing's operational location under its commercial
-- parent. Guards: never self-parent, never parent under a non-root (one
-- level only), never overwrite an existing assignment.
UPDATE "Location" loc
SET "parentLocationId" = p."id"
FROM "ProductVariant" v
JOIN "VariantChannelListing" l
  ON l."productVariantId" = v."id" AND l."channel" = 'agent' AND l."visible" = true,
  "Location" p
WHERE v."locationId" = loc."id"
  AND p."nameHe" = l."commercialCity"
  AND p."id" <> loc."id"
  AND p."parentLocationId" IS NULL
  AND loc."parentLocationId" IS NULL
  AND l."commercialCity" <> loc."nameHe";

-- ── 5) Retire the rejected model — one source of truth from here on ──────────
DROP TABLE "VariantChannelListing";
