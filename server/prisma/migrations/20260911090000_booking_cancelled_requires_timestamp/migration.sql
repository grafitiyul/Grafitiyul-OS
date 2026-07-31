-- Booking integrity: a cancelled booking MUST carry its cancellation time.
--
-- Background (production incident, 2026-07-31): the Airtable child-deps
-- reconciler cancelled bookings that had no Airtable counterpart — they were
-- created by the legacy migration import — writing status='cancelled' without
-- `cancelledAt`. Measured in production the same afternoon: 3 such bookings were
-- live, ALL on the next morning's tour (2026-08-01 10:00), covering 8 confirmed
-- seats across deals #26047, #26283 and #26335. Every one of those deals was
-- WON and every registration was still `confirmed`.
--
-- The seats never moved (TicketRegistration is the seat SSOT and was untouched),
-- but the tour screen renders customer cards off Booking status, so the
-- participants disappeared from view. The missing timestamp is what made the
-- state indistinguishable from a genuine cancellation.
--
-- This migration does two things, in order, and both are deliberate.

-- ── 1. REPAIR ────────────────────────────────────────────────────────────────
-- Restore bookings carrying the exact ghost signature:
--
--     status = 'cancelled'  AND  cancelledAt IS NULL  AND  live capacity seats
--
-- That combination cannot describe a genuine cancellation. The canonical cancel
-- path (`cancelDealBooking`) has always stamped `cancelledAt`, and a real
-- cancellation releases its registrations. A row matching all three was never
-- cancelled by a person — it was mutated by a reconciler that had no authority
-- to do so. `active` is the correct target, not a guess: the booking was created
-- active and nothing ever cancelled it through the real path.
--
-- The repair lives HERE rather than only in scripts/repair-ghost-cancelled-
-- bookings.mjs because the constraint below is VALIDATED: leaving the two steps
-- separate would let a row created in the gap between the script run and the
-- deploy wedge the whole service at boot (`prisma migrate deploy && node`).
-- Idempotent — a second run matches nothing.
UPDATE "Booking" b
   SET "status" = 'active'
 WHERE b."status" = 'cancelled'
   AND b."cancelledAt" IS NULL
   AND EXISTS (
     SELECT 1 FROM "TicketRegistration" r
      WHERE r."bookingId" = b."id"
        AND r."status" IN ('held', 'confirmed', 'active')
        AND coalesce(r."quantity", 0) > 0
   );

-- Any REMAINING cancellation with no timestamp holds no seats, so resurrecting
-- it would be inventing a booking nobody asked for. The conservative repair is
-- to make the existing state legible instead: stamp the moment the row was last
-- written, which is when the cancellation actually happened.
UPDATE "Booking"
   SET "cancelledAt" = "updatedAt"
 WHERE "status" = 'cancelled'
   AND "cancelledAt" IS NULL;

-- ── 2. THE INVARIANT ─────────────────────────────────────────────────────────
-- The canonical cancel has always set both fields. This makes the half-written
-- state impossible for every writer, present and future, rather than trusting
-- each call site to remember. Validated on purpose: after the repair above there
-- is nothing left to violate it, and a failure here would mean the repair was
-- incomplete — which is exactly when we want to hear about it.
ALTER TABLE "Booking"
  DROP CONSTRAINT IF EXISTS "Booking_cancelled_requires_timestamp";

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_cancelled_requires_timestamp"
  CHECK ("status" <> 'cancelled' OR "cancelledAt" IS NOT NULL);
