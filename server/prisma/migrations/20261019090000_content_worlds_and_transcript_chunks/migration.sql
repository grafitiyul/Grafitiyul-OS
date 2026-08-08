-- Content Worlds (עולם תוכן) + durable transcript chunks for large media.
--
-- ADDITIVE except for ONE new NOT NULL column (LibraryCategory.worldId), which
-- is added in the safe four-step order below rather than as a bare
-- "ADD COLUMN ... NOT NULL". Production currently holds 0 LibraryCategory rows,
-- but the backfill runs anyway so this migration is correct on ANY database —
-- including a developer's, a restored snapshot, or a future replay.
--
-- No existing gallery, media, tour or transcript row is touched.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Content Worlds
-- ─────────────────────────────────────────────────────────────────────────────
-- A ContentWorld is a BUSINESS DOMAIN (what the content is about).
-- ContentWorkspace, which already exists, is an ACCESS boundary (who may see
-- it). They are deliberately separate models — see the schema comment.
CREATE TABLE "ContentWorld" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nameHe" TEXT NOT NULL,
    "nameEn" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentWorld_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContentWorld_key_key" ON "ContentWorld"("key");
CREATE INDEX "ContentWorld_active_sortOrder_idx" ON "ContentWorld"("active", "sortOrder");

-- Seed the two worlds that exist today. Categories are deliberately NOT seeded:
-- the owner creates the real ones through the UI.
INSERT INTO "ContentWorld" ("id", "key", "nameHe", "nameEn", "sortOrder", "createdAt", "updatedAt")
VALUES
  ('cworld_gos',       'gos',       'GOS',       'GOS',       0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cworld_challenge', 'challenge', 'CHALLENGE', 'CHALLENGE', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Categories belong to exactly one world
-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1: add nullable, so the statement cannot fail on existing rows.
ALTER TABLE "LibraryCategory" ADD COLUMN "worldId" TEXT;

-- Step 2: backfill. Any pre-existing category was created before worlds existed
-- and therefore belongs to GOS — the only world in use until now. CHALLENGE is
-- never assigned by a migration; that is an operator decision.
UPDATE "LibraryCategory" SET "worldId" = 'cworld_gos' WHERE "worldId" IS NULL;

-- Step 3: now that every row has a value, enforce it.
ALTER TABLE "LibraryCategory" ALTER COLUMN "worldId" SET NOT NULL;

-- Step 4: constraints. The unique key is (worldId, nameHe) — "הרצאות" may exist
-- under GOS *and* under CHALLENGE as two distinct categories.
ALTER TABLE "LibraryCategory" ADD CONSTRAINT "LibraryCategory_worldId_fkey"
  FOREIGN KEY ("worldId") REFERENCES "ContentWorld"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "LibraryCategory_worldId_archived_sortOrder_idx" ON "LibraryCategory"("worldId", "archived", "sortOrder");
CREATE UNIQUE INDEX "LibraryCategory_worldId_nameHe_key" ON "LibraryCategory"("worldId", "nameHe");

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. An item may belong to several worlds (relation, never a copied file)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "LibraryItemWorld" (
    "itemId" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LibraryItemWorld_pkey" PRIMARY KEY ("itemId","worldId")
);

CREATE INDEX "LibraryItemWorld_worldId_idx" ON "LibraryItemWorld"("worldId");

ALTER TABLE "LibraryItemWorld" ADD CONSTRAINT "LibraryItemWorld_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "LibraryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LibraryItemWorld" ADD CONSTRAINT "LibraryItemWorld_worldId_fkey"
  FOREIGN KEY ("worldId") REFERENCES "ContentWorld"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Large-media transcription: durable per-chunk progress
-- ─────────────────────────────────────────────────────────────────────────────
-- `stage` explains WHAT a running job is doing; the two counters are the only
-- truthful basis for a percentage; `cancelRequested` is cooperative — the worker
-- stops between chunks rather than killing a request mid-flight.
ALTER TABLE "MediaJob"
  ADD COLUMN "stage" TEXT,
  ADD COLUMN "progressDone" INTEGER,
  ADD COLUMN "progressTotal" INTEGER,
  ADD COLUMN "cancelRequested" BOOLEAN NOT NULL DEFAULT false;

-- One row per audio slice. This is what makes a multi-hour transcription
-- survivable: progress lives here, not in process memory, so a deploy or a
-- crash at chunk 47 of 50 costs only the unfinished chunks.
CREATE TABLE "MediaTranscriptChunk" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "startSeconds" DOUBLE PRECISION NOT NULL,
    "endSeconds" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "text" TEXT,
    "segments" JSONB,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaTranscriptChunk_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MediaTranscriptChunk_jobId_index_key" ON "MediaTranscriptChunk"("jobId", "index");
CREATE INDEX "MediaTranscriptChunk_jobId_status_idx" ON "MediaTranscriptChunk"("jobId", "status");
CREATE INDEX "MediaTranscriptChunk_mediaId_idx" ON "MediaTranscriptChunk"("mediaId");

ALTER TABLE "MediaTranscriptChunk" ADD CONSTRAINT "MediaTranscriptChunk_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "MediaJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
