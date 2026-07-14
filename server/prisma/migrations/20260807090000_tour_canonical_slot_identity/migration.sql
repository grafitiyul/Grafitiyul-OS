-- Canonical identity of a GENERATED open-tour occurrence is
-- (openTourTemplateId, date, startTime) — NOT (generatedByRuleId, date).
--
-- WHY: a schedule rule that is DELETED and RECREATED gets a new id, so the old
-- unique (generatedByRuleId, date) never fired across the recreate — two rules
-- generated the same Thursdays and both survived (the 2026-07 duplicates). The
-- rule id is not a stable occurrence identity; the template + date + clock time
-- is. This migration replaces the rule-scoped unique with a PARTIAL unique index
-- over ACTIVE generated slots, which is stable across rule delete/recreate AND
-- safe under two concurrent generation runs (INSERT ... ON CONFLICT DO NOTHING).

-- 1. Drop the rule-scoped unique index (kept only as a plain lookup index for
--    ruleEdit's per-rule slot queries).
DROP INDEX IF EXISTS "TourEvent_generatedByRuleId_date_key";
CREATE INDEX IF NOT EXISTS "TourEvent_generatedByRuleId_date_idx" ON "TourEvent"("generatedByRuleId", "date");

-- 2. Defensive de-duplication so the partial unique index can be created even if
--    scheduled twins exist. Keep the best row per (template, date, startTime)
--    (most Woo history, then oldest); cancel the redundant EMPTY twins (never
--    delete; never touch a twin that carries registrations or bookings — those
--    are surfaced by a failed index build rather than silently merged). On the
--    live DB this is a no-op (the earlier dedupe already left one scheduled row
--    per slot), but it makes the structural migration self-healing.
WITH ranked AS (
  SELECT te.id,
         row_number() OVER (
           PARTITION BY te."openTourTemplateId", te."date", te."startTime"
           ORDER BY (SELECT count(*) FROM "WooVariationLink" w WHERE w."tourEventId" = te.id) DESC,
                    te."createdAt" ASC
         ) AS rn
  FROM "TourEvent" te
  WHERE te."kind" = 'group_slot' AND te."status" = 'scheduled'
    AND te."openTourTemplateId" IS NOT NULL AND te."date" IS NOT NULL AND te."startTime" IS NOT NULL
)
UPDATE "TourEvent" t
SET "status" = 'cancelled', "cancelledAt" = now(),
    "wooSyncStatus" = 'pending', "wooSyncOrigin" = 'maintenance', "wooDesiredRevision" = "wooDesiredRevision" + 1
FROM ranked r
WHERE t.id = r.id AND r.rn > 1
  AND NOT EXISTS (SELECT 1 FROM "TicketRegistration" tr WHERE tr."tourEventId" = t.id)
  AND NOT EXISTS (SELECT 1 FROM "Booking" b WHERE b."tourEventId" = t.id);

-- 3. The structural invariant: at most ONE active (scheduled) generated slot per
--    logical occurrence. Partial so cancelled/postponed history is unbounded,
--    manual tours (openTourTemplateId NULL) are excluded, and different clock
--    times on the same date remain independent occurrences.
CREATE UNIQUE INDEX IF NOT EXISTS "TourEvent_active_generated_slot_key"
ON "TourEvent" ("openTourTemplateId", "date", "startTime")
WHERE "kind" = 'group_slot' AND "status" = 'scheduled'
  AND "openTourTemplateId" IS NOT NULL AND "date" IS NOT NULL AND "startTime" IS NOT NULL;
