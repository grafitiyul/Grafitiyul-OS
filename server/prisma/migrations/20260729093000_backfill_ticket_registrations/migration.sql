-- Backfill the canonical TicketRegistration SSOT from every existing Booking, so
-- occupancy (now sourced from active registrations) is consistent the moment the
-- new code serves traffic. One 'deal' registration per booking, carrying the
-- tour's operational variant as its product identity.
--   * booking status 'active'          → registration 'active'  (counts)
--   * booking status cancelled/orphaned → registration 'cancelled' (excluded)
-- Idempotent: skips any booking that already has a 'deal' registration, so a
-- re-run (or a later booking created by the new code path) is never duplicated.
INSERT INTO "TicketRegistration" (
  "id", "tourEventId", "productVariantId", "quantity", "source",
  "bookingId", "dealId", "status", "cancelledAt", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  b."tourEventId",
  te."productVariantId",
  b."seats",
  'deal',
  b."id",
  b."dealId",
  CASE WHEN b."status" = 'active' THEN 'active' ELSE 'cancelled' END,
  CASE WHEN b."status" <> 'active' THEN COALESCE(b."cancelledAt", CURRENT_TIMESTAMP) ELSE NULL END,
  b."createdAt",
  CURRENT_TIMESTAMP
FROM "Booking" b
JOIN "TourEvent" te ON te."id" = b."tourEventId"
WHERE NOT EXISTS (
  SELECT 1 FROM "TicketRegistration" r
  WHERE r."bookingId" = b."id" AND r."source" = 'deal'
);
