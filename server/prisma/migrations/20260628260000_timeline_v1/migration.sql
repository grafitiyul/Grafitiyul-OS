-- Timeline V1 — reusable activity feed (notes now; more kinds later).
--
-- ADDITIVE ONLY. Two new tables: a polymorphic "TimelineEntry" spine scoped by
-- (subjectType, subjectId) — NO FK on the subject by design, so the same feed
-- attaches to Deals / Contacts / Organizations / future entities — and a
-- "TimelineComment" child with a real FK (cascade) to its entry. Nothing is
-- dropped; Deal.notes is intentionally left intact. Defensive (IF NOT EXISTS /
-- guarded constraint) so it is safe to re-run.

-- ── TimelineEntry (the spine) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TimelineEntry" (
  "id"           TEXT NOT NULL,
  "subjectType"  TEXT NOT NULL,
  "subjectId"    TEXT NOT NULL,
  "kind"         TEXT NOT NULL DEFAULT 'note',
  "body"         TEXT,
  "data"         JSONB,
  "isPinned"     BOOLEAN NOT NULL DEFAULT false,
  "pinSortOrder" INTEGER NOT NULL DEFAULT 0,
  "isSystem"     BOOLEAN NOT NULL DEFAULT false,
  "createdBy"    TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  "editedAt"     TIMESTAMP(3),
  "deletedAt"    TIMESTAMP(3),
  CONSTRAINT "TimelineEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TimelineEntry_subject_createdAt_idx"
  ON "TimelineEntry"("subjectType", "subjectId", "createdAt");
CREATE INDEX IF NOT EXISTS "TimelineEntry_subject_pin_idx"
  ON "TimelineEntry"("subjectType", "subjectId", "isPinned", "pinSortOrder");

-- ── TimelineComment (child of an entry) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TimelineComment" (
  "id"        TEXT NOT NULL,
  "entryId"   TEXT NOT NULL,
  "body"      TEXT NOT NULL,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "TimelineComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TimelineComment_entryId_createdAt_idx"
  ON "TimelineComment"("entryId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TimelineComment_entryId_fkey'
  ) THEN
    ALTER TABLE "TimelineComment"
      ADD CONSTRAINT "TimelineComment_entryId_fkey"
      FOREIGN KEY ("entryId") REFERENCES "TimelineEntry"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
