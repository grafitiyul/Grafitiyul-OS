-- Deal LOST outcome — structured fields (lostReasonId + lostNotes).
--
-- ADDITIVE ONLY. Two new nullable columns on "Deal", one index, and a FK to the
-- existing "LostReason" catalog (ON DELETE SET NULL). Nothing is dropped. The
-- legacy free-text "lostReason" column is LEFT INTACT as a display fallback.
-- Written defensively (IF NOT EXISTS / guarded) so it is safe to re-run.

-- ── New columns ─────────────────────────────────────────────────────────────
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "lostReasonId" TEXT;
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "lostNotes" TEXT;

-- ── Index + FK ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "Deal_lostReasonId_idx" ON "Deal"("lostReasonId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Deal_lostReasonId_fkey'
  ) THEN
    ALTER TABLE "Deal"
      ADD CONSTRAINT "Deal_lostReasonId_fkey"
      FOREIGN KEY ("lostReasonId") REFERENCES "LostReason"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ── Best-effort backfill of the legacy free-text "lostReason" ───────────────
-- Old saves stored either "<reason name>" or "<reason name> — <notes>". We move
-- the matched reason into the structured FK and the remainder into lostNotes.
-- This only fills the NEW columns; the legacy "lostReason" text is never
-- cleared, so any row we cannot confidently match keeps its legacy fallback.

-- 1) Exact reason-name matches (no notes).
UPDATE "Deal" d
SET "lostReasonId" = lr."id"
FROM "LostReason" lr
WHERE d."lostReasonId" IS NULL
  AND d."status" = 'lost'
  AND d."lostReason" IS NOT NULL
  AND d."lostReason" = lr."nameHe";

-- 2) "<reason name> — <notes>" matches: link the reason, move the remainder
--    (everything after the " — " separator) into lostNotes.
UPDATE "Deal" d
SET "lostReasonId" = lr."id",
    "lostNotes" = substring(d."lostReason" FROM (char_length(lr."nameHe") + char_length(' — ') + 1))
FROM "LostReason" lr
WHERE d."lostReasonId" IS NULL
  AND d."status" = 'lost'
  AND d."lostReason" IS NOT NULL
  AND d."lostReason" LIKE lr."nameHe" || ' — %';
