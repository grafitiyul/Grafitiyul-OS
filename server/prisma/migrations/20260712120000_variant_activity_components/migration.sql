-- Move default Activity Components from Product to ProductVariant (Tours module,
-- architecture correction). Defaults belong to the VARIANT: the same product
-- family can have a tour-only variant, a tour+workshop variant, etc.
--
-- Data migration is SAFE and non-guessing:
--   1. GUARD FIRST — if any Product-level default rows exist on a product that
--      does NOT have exactly one variant (0 or >1), abort the whole migration
--      (it runs in a transaction, so nothing is applied) and report the count.
--      Those are ambiguous and must be assigned to a specific variant by hand.
--   2. Otherwise migrate each single-variant product's rows to that one variant.
--   3. Drop the old Product-level table — no dual ownership left behind.
-- In the expected state (no Product defaults configured yet) this is a clean
-- create + drop with nothing to migrate.

-- 1. Guard: refuse to guess on ambiguous data.
DO $$
DECLARE
  ambiguous INT;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ProductActivityComponent') THEN
    SELECT COUNT(*) INTO ambiguous
    FROM "ProductActivityComponent" pac
    WHERE (SELECT COUNT(*) FROM "ProductVariant" v WHERE v."productId" = pac."productId") <> 1;
    IF ambiguous > 0 THEN
      RAISE EXCEPTION
        'Ambiguous Product-level activity components: % row(s) on products with 0 or multiple variants. Assign them to a specific variant manually, then re-run this migration.', ambiguous;
    END IF;
  END IF;
END $$;

-- 2. New variant-level join table.
CREATE TABLE IF NOT EXISTS "ProductVariantActivityComponent" (
    "id" TEXT NOT NULL,
    "productVariantId" TEXT NOT NULL,
    "activityComponentId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductVariantActivityComponent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductVariantActivityComponent_productVariantId_activityComponentId_key" ON "ProductVariantActivityComponent"("productVariantId", "activityComponentId");
CREATE INDEX IF NOT EXISTS "ProductVariantActivityComponent_productVariantId_idx" ON "ProductVariantActivityComponent"("productVariantId");
CREATE INDEX IF NOT EXISTS "ProductVariantActivityComponent_activityComponentId_idx" ON "ProductVariantActivityComponent"("activityComponentId");

ALTER TABLE "ProductVariantActivityComponent"
  ADD CONSTRAINT "ProductVariantActivityComponent_productVariantId_fkey"
  FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductVariantActivityComponent"
  ADD CONSTRAINT "ProductVariantActivityComponent_activityComponentId_fkey"
  FOREIGN KEY ("activityComponentId") REFERENCES "ActivityComponent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. Migrate single-variant products' defaults to their one variant (guard above
-- guarantees every remaining row belongs to a product with exactly one variant).
INSERT INTO "ProductVariantActivityComponent" ("id", "productVariantId", "activityComponentId", "sortOrder", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, v."id", pac."activityComponentId", pac."sortOrder", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "ProductActivityComponent" pac
JOIN "ProductVariant" v ON v."productId" = pac."productId"
ON CONFLICT ("productVariantId", "activityComponentId") DO NOTHING;

-- 4. Drop the Product-level table (and its FKs) — single ownership.
DROP TABLE IF EXISTS "ProductActivityComponent";
