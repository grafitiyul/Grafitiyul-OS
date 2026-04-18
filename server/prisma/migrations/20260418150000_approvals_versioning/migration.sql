-- Approvals V2: versioned answers, per-question status, trimmed attempt status.
-- Approach: drop the old Answer table (Slice 7 is a clean break — no production
-- data worth preserving), add new FlowAnswer with versioning, and normalise
-- Attempt columns to the new 3-state model.

-- 1. Drop the legacy Answer table (and its FK/unique constraint via CASCADE).
DROP TABLE IF EXISTS "Answer" CASCADE;

-- 2. Normalise any existing Attempt rows into the new status enum:
--    'awaiting_review' | 'returned' → 'submitted'
--    'completed'                     → 'approved'
--    'in_progress'                   → 'in_progress'
UPDATE "Attempt" SET "status" = 'submitted'  WHERE "status" IN ('awaiting_review','returned');
UPDATE "Attempt" SET "status" = 'approved'   WHERE "status" = 'completed';

-- 3. New Attempt columns. reviewNote is replaced by per-question adminComment.
ALTER TABLE "Attempt" DROP COLUMN IF EXISTS "reviewNote";
ALTER TABLE "Attempt" ADD  COLUMN "workerIdentifier" TEXT;
ALTER TABLE "Attempt" ADD  COLUMN "submittedAt"      TIMESTAMP(3);
ALTER TABLE "Attempt" ADD  COLUMN "approvedAt"       TIMESTAMP(3);

-- 4. The new versioned answer table.
CREATE TABLE "FlowAnswer" (
    "id"             TEXT         NOT NULL,
    "attemptId"      TEXT         NOT NULL,
    "flowNodeId"     TEXT         NOT NULL,
    "questionItemId" TEXT         NOT NULL,
    "openText"       TEXT,
    "answerChoice"   TEXT,
    "answerLabel"    TEXT,
    "version"        INTEGER      NOT NULL,
    "status"         TEXT         NOT NULL DEFAULT 'pending',
    "adminComment"   TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt"     TIMESTAMP(3),

    CONSTRAINT "FlowAnswer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FlowAnswer_attemptId_flowNodeId_version_key"
    ON "FlowAnswer" ("attemptId", "flowNodeId", "version");
CREATE INDEX "FlowAnswer_attemptId_flowNodeId_idx"
    ON "FlowAnswer" ("attemptId", "flowNodeId");

ALTER TABLE "FlowAnswer"
    ADD CONSTRAINT "FlowAnswer_attemptId_fkey"
    FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FlowAnswer"
    ADD CONSTRAINT "FlowAnswer_flowNodeId_fkey"
    FOREIGN KEY ("flowNodeId") REFERENCES "FlowNode"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
