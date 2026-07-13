-- WooCommerce compatibility model: adapt the sync to the LIVE store structure
-- (global-taxonomy date+time, activity-as-attribute, adult/child as separate
-- age variations). Purely additive; safe on existing rows (the sync has never
-- run in prod — env-name mismatch kept wooConfigured() false — so both tables
-- are empty and the unique-index swap below cannot conflict).

-- ── WooProductMapping: per-product compatibility descriptor ──────────────────
-- config Json holds the attribute identities (date/time/activity/age), the
-- taxonomy mode, this card's activity term, and the ticketType→age-term map, so
-- no product-specific behaviour is hardcoded in the sync service.
ALTER TABLE "WooProductMapping" ADD COLUMN IF NOT EXISTS "config" JSONB;

-- ── WooVariationLink: one row per (tour × card × variant) ────────────────────
-- A single occurrence now yields MULTIPLE variations (one per ticket type/age),
-- so variantKey disambiguates siblings; ticketTypeId records which ticket type
-- (age) the variation prices.
ALTER TABLE "WooVariationLink" ADD COLUMN IF NOT EXISTS "variantKey" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "WooVariationLink" ADD COLUMN IF NOT EXISTS "ticketTypeId" TEXT;

-- Swap the uniqueness from (tour, card) to (tour, card, variant). Safe: table is
-- empty in every environment (sync has never written).
DROP INDEX IF EXISTS "WooVariationLink_tourEventId_cardGroupId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "WooVariationLink_tourEventId_cardGroupId_variantKey_key"
  ON "WooVariationLink"("tourEventId", "cardGroupId", "variantKey");
