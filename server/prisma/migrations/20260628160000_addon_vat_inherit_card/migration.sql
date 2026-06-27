-- Add-on VAT: support "כמו כרטיס התמחור" (inherit the Pricing Card's VAT).
--
-- RELAXING + behavior-preserving. Addon.vatMode becomes nullable (null = inherit
-- from the card). Existing values are set to NULL: at pricing time the catalog
-- vatMode was only consumed by the system שבת/חג surcharge (which we WANT to
-- follow the card now) — ordinary add-ons are priced by their per-card
-- PriceRuleAddon.vatMode, so nulling the inert catalog value changes nothing for
-- them. Idempotent.

ALTER TABLE "Addon" ALTER COLUMN "vatMode" DROP NOT NULL;
ALTER TABLE "Addon" ALTER COLUMN "vatMode" DROP DEFAULT;

-- Default every catalog add-on to "inherit from card". Owners can re-set an
-- explicit VAT per add-on afterwards.
UPDATE "Addon" SET "vatMode" = NULL WHERE "vatMode" IS NOT NULL;
