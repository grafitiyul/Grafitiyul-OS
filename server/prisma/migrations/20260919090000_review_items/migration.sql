-- Management Tasks ("משימות הנהלה") — the operational review inbox.
--
-- A new table rather than reusing Task or OperationalIssue:
--   Task             is Deal-scoped (dealId required, cascade); a tour-summary
--                    review belongs to a tour and a guide.
--   OperationalIssue auto-resolves when its condition disappears — that IS its
--                    contract, and every detector depends on it. A review card
--                    must not vanish because the summary still exists.
--
-- Purely additive.

CREATE TABLE IF NOT EXISTS "ReviewItem" (
  "id"            TEXT NOT NULL,
  "kind"          TEXT NOT NULL,
  "dedupeKey"     TEXT NOT NULL,
  "status"        TEXT NOT NULL DEFAULT 'open',
  "title"         TEXT NOT NULL,
  "summary"       TEXT,
  "data"          JSONB,
  "entityRefs"    JSONB,
  "tourEventId"   TEXT,
  "submissionId"  TEXT,
  "personRefId"   TEXT,
  "dealId"        TEXT,
  "autId"         TEXT,
  "handledAt"     TIMESTAMP(3),
  "handledBy"     TEXT,
  "handledByName" TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReviewItem_pkey" PRIMARY KEY ("id")
);

-- Exactly-once creation: a re-submitted questionnaire or a replayed automation
-- can never produce a second card for the same business event.
CREATE UNIQUE INDEX IF NOT EXISTS "ReviewItem_dedupeKey_key" ON "ReviewItem" ("dedupeKey");
CREATE INDEX IF NOT EXISTS "ReviewItem_status_createdAt_idx" ON "ReviewItem" ("status", "createdAt");
CREATE INDEX IF NOT EXISTS "ReviewItem_kind_status_idx"      ON "ReviewItem" ("kind", "status");
CREATE INDEX IF NOT EXISTS "ReviewItem_tourEventId_idx"      ON "ReviewItem" ("tourEventId");
CREATE INDEX IF NOT EXISTS "ReviewItem_submissionId_idx"     ON "ReviewItem" ("submissionId");
