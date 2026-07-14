-- Legacy Data Migration foundation (Slice 1) — additive only, no customer data.
-- Three infrastructure tables + their indexes. Nothing in the live app reads or
-- writes these yet; extraction/review/import slices fill them later. Idempotent
-- (IF NOT EXISTS) so a re-apply is harmless.

-- THE crosswalk + archive record. Unique (sourceSystem, sourceType, sourceId)
-- is the idempotency + reversibility key.
CREATE TABLE IF NOT EXISTS "LegacyRecord" (
    "id" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "snapshotId" TEXT,
    "importBatchId" TEXT,
    "payload" JSONB,
    "cardData" JSONB,
    "entityType" TEXT,
    "entityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LegacyRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LegacyRecord_sourceSystem_sourceType_sourceId_key"
    ON "LegacyRecord" ("sourceSystem", "sourceType", "sourceId");
CREATE INDEX IF NOT EXISTS "LegacyRecord_entityType_entityId_idx"
    ON "LegacyRecord" ("entityType", "entityId");
CREATE INDEX IF NOT EXISTS "LegacyRecord_snapshotId_idx"
    ON "LegacyRecord" ("snapshotId");
CREATE INDEX IF NOT EXISTS "LegacyRecord_importBatchId_idx"
    ON "LegacyRecord" ("importBatchId");
CREATE INDEX IF NOT EXISTS "LegacyRecord_sourceSystem_sourceType_idx"
    ON "LegacyRecord" ("sourceSystem", "sourceType");

-- The migration review ledger. Unique (queue, subjectKey) → idempotent re-seed.
CREATE TABLE IF NOT EXISTS "MigrationDecision" (
    "id" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "proposal" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decision" JSONB,
    "decidedBy" TEXT,
    "decidedByName" TEXT,
    "decidedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MigrationDecision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MigrationDecision_queue_subjectKey_key"
    ON "MigrationDecision" ("queue", "subjectKey");
CREATE INDEX IF NOT EXISTS "MigrationDecision_queue_status_idx"
    ON "MigrationDecision" ("queue", "status");

-- The resumable-run spine. Claim-based concurrency (like WhatsAppScheduledMessage).
CREATE TABLE IF NOT EXISTS "MigrationRun" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "target" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "snapshotId" TEXT,
    "batchId" TEXT,
    "cursor" JSONB,
    "counters" JSONB,
    "claimedAt" TIMESTAMP(3),
    "claimedBy" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MigrationRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MigrationRun_kind_status_idx"
    ON "MigrationRun" ("kind", "status");
CREATE INDEX IF NOT EXISTS "MigrationRun_status_claimedAt_idx"
    ON "MigrationRun" ("status", "claimedAt");
CREATE INDEX IF NOT EXISTS "MigrationRun_snapshotId_idx"
    ON "MigrationRun" ("snapshotId");
CREATE INDEX IF NOT EXISTS "MigrationRun_batchId_idx"
    ON "MigrationRun" ("batchId");
