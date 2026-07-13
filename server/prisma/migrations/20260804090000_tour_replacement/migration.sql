-- Registered-tour replacement link: the original (cancelled) tour points at its
-- replacement, enabling idempotent replace + the "replaced" UI state. Additive.
ALTER TABLE "TourEvent" ADD COLUMN IF NOT EXISTS "replacedByTourEventId" TEXT;
