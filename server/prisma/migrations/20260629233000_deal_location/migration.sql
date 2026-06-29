-- Deal: operational tour CITY (Deal.locationId). ADDITIVE, nullable only.
--
-- The city is usually the chosen productVariant's location, but the user may pick
-- ANY CRM location as a manual override even when no variant exists for it (the
-- two-section Location selector). Pricing is unchanged — it still resolves via
-- productVariantId; locationId only remembers the operational city. FK SET NULL so
-- deleting a Location never deletes deals.
--
-- Defensive (IF NOT EXISTS / guarded constraint) so it is safe to re-run.

ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "locationId" TEXT;
CREATE INDEX IF NOT EXISTS "Deal_locationId_idx" ON "Deal"("locationId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Deal_locationId_fkey') THEN
    ALTER TABLE "Deal"
      ADD CONSTRAINT "Deal_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "Location"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
