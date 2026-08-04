-- PaymentRequest.productDescriptionSource — explicit ownership of the English
-- customer-facing wording. ADDITIVE: one new column with a safe default.
--
-- WHY: the description used to be refreshed by IDENTITY-CHANGE DETECTION (the
-- request's productId/productVariantId differing from the Deal's). Any write
-- that updated identity and wording in the same statement — a QA restore, a
-- script, a product changed and changed back between opens — left stale
-- wording frozen forever, because the trigger had already been satisfied.
-- Deal #26617 shipped a Cardcom page reading "Premium Graffiti Tour & Workshop
-- Including Wall Mural" for a plain Tel Aviv graffiti tour.
--
-- The replacement rule is ownership, not change-detection:
--   'auto'     → the row FOLLOWS the Deal's canonical English label on every
--                read (self-healing; a stale value repairs itself on next open)
--   'operator' → a deliberate manual override, never auto-refreshed
--
-- BACKFILL: every existing row defaults to 'auto'. That is the correct and
-- safe classification here — it makes stale rows self-repair, and the
-- production audit (2026-08-04) confirmed no existing cardcom request carried
-- a deliberate operator override: the only non-canonical wording in the table
-- was the QA-written value on #26617 that this column exists to prevent.
-- A genuine override created from now on is recorded explicitly at write time.

ALTER TABLE "PaymentRequest"
  ADD COLUMN IF NOT EXISTS "productDescriptionSource" TEXT NOT NULL DEFAULT 'auto';
