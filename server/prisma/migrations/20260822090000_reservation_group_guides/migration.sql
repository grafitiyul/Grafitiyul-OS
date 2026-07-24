-- Agent reservations: "מספר מדריכים" (number of guides) per reservation group.
--
-- ADDITIVE ONLY. One nullable column, idempotent. Canonically this IS the
-- pricing group count of the reservation card (same contract as Deal.groups:
-- NULL = 1). It flows: form → ReservationGroup.groups → created Deal.groups →
-- the engine's group-aware pricing. User-facing label is "number of guides";
-- no separate commercial field exists or is created.

ALTER TABLE "ReservationGroup" ADD COLUMN IF NOT EXISTS "groups" INTEGER;
