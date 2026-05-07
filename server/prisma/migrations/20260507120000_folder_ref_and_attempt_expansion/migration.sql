-- Reusable bank folder references in flows + per-attempt runtime expansion.
--
-- 1. FlowNode gains an optional bankFolderId. When set (with kind='folderRef')
--    the node is a reference to a bank folder rather than a regular content/
--    question/group node. ON DELETE SET NULL so removing the bank folder
--    degrades the folderRef gracefully.
ALTER TABLE "FlowNode" ADD COLUMN "bankFolderId" TEXT;
ALTER TABLE "FlowNode"
  ADD CONSTRAINT "FlowNode_bankFolderId_fkey"
  FOREIGN KEY ("bankFolderId") REFERENCES "ItemBankFolder"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "FlowNode_bankFolderId_idx" ON "FlowNode"("bankFolderId");

-- 2. Attempt gains a per-attempt resolved structure (`expansion`) and the
--    cursor key into it (`currentStepId`). Old attempts have null/null and
--    the runtime falls back to computing from flow.nodes (legacy path).
ALTER TABLE "Attempt" ADD COLUMN "expansion" JSONB;
ALTER TABLE "Attempt" ADD COLUMN "currentStepId" TEXT;

-- 3. FlowAnswer.stepId becomes the canonical identity. For non-folderRef
--    steps stepId == flowNodeId; for folderRef-expanded steps stepId is
--    synthetic and flowNodeId is null.
--
--    Drop the old FK constraint so flowNodeId can be nullable.
ALTER TABLE "FlowAnswer" DROP CONSTRAINT "FlowAnswer_flowNodeId_fkey";

ALTER TABLE "FlowAnswer" ADD COLUMN "stepId" TEXT;
-- Backfill: every existing answer is for a real FlowNode, so stepId = flowNodeId.
UPDATE "FlowAnswer" SET "stepId" = "flowNodeId" WHERE "stepId" IS NULL;
ALTER TABLE "FlowAnswer" ALTER COLUMN "stepId" SET NOT NULL;

-- flowNodeId becomes nullable; re-add the FK with the same cascade behavior
-- but allowing NULL.
ALTER TABLE "FlowAnswer" ALTER COLUMN "flowNodeId" DROP NOT NULL;
ALTER TABLE "FlowAnswer"
  ADD CONSTRAINT "FlowAnswer_flowNodeId_fkey"
  FOREIGN KEY ("flowNodeId") REFERENCES "FlowNode"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Swap unique constraint and index from flowNodeId to stepId.
DROP INDEX "FlowAnswer_attemptId_flowNodeId_version_key";
DROP INDEX "FlowAnswer_attemptId_flowNodeId_idx";
CREATE UNIQUE INDEX "FlowAnswer_attemptId_stepId_version_key"
  ON "FlowAnswer"("attemptId", "stepId", "version");
CREATE INDEX "FlowAnswer_attemptId_stepId_idx"
  ON "FlowAnswer"("attemptId", "stepId");
