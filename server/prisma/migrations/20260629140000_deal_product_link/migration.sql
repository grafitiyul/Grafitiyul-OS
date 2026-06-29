-- Deal → Product / ProductVariant link + base-price override flag.
--
-- ADDITIVE ONLY. Connects the Tour Details card to the existing product/location
-- catalog so the pricing engine can compute a base price. Nothing is dropped; no
-- data migration. FKs use ON DELETE SET NULL so deleting a catalog product/variant
-- never deletes deals — it just clears the link.
--
--   • "productId"            — the chosen Product (operational tour selection).
--   • "productVariantId"     — the chosen Product×Location variant ("city").
--   • "basePriceOverridden"  — TRUE once the user hand-sets the base price, so
--                              auto-recalc never silently overwrites it. Existing
--                              rows default to FALSE (engine is the source).
--
-- Written defensively (IF NOT EXISTS / guarded constraints) so it is safe to re-run.

ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "productId" TEXT;
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "productVariantId" TEXT;
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "basePriceOverridden" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "Deal_productId_idx" ON "Deal"("productId");
CREATE INDEX IF NOT EXISTS "Deal_productVariantId_idx" ON "Deal"("productVariantId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Deal_productId_fkey') THEN
    ALTER TABLE "Deal"
      ADD CONSTRAINT "Deal_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "Product"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Deal_productVariantId_fkey') THEN
    ALTER TABLE "Deal"
      ADD CONSTRAINT "Deal_productVariantId_fkey"
      FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
