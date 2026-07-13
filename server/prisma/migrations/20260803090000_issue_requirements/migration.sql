-- Part 4: Operations Control impact-handling — first-class sub-requirements +
-- per-recipient notification audit linked to OperationalIssue. Purely additive.

-- ── OperationalIssue: current impact revision ───────────────────────────────
ALTER TABLE "OperationalIssue" ADD COLUMN IF NOT EXISTS "revision" TEXT;

-- ── IssueRequirement ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "IssueRequirement" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "revision" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "note" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolvedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IssueRequirement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "IssueRequirement_issueId_revision_kind_key" ON "IssueRequirement"("issueId", "revision", "kind");
CREATE INDEX IF NOT EXISTS "IssueRequirement_issueId_state_idx" ON "IssueRequirement"("issueId", "state");

ALTER TABLE "IssueRequirement"
  ADD CONSTRAINT "IssueRequirement_issueId_fkey"
  FOREIGN KEY ("issueId") REFERENCES "OperationalIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── IssueNotification ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "IssueNotification" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "recipientKey" TEXT NOT NULL,
    "recipientName" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "channel" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sentAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "providerResult" JSONB,
    "retryHistory" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IssueNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "IssueNotification_requirementId_recipientKey_channel_key" ON "IssueNotification"("requirementId", "recipientKey", "channel");
CREATE INDEX IF NOT EXISTS "IssueNotification_requirementId_status_idx" ON "IssueNotification"("requirementId", "status");

ALTER TABLE "IssueNotification"
  ADD CONSTRAINT "IssueNotification_requirementId_fkey"
  FOREIGN KEY ("requirementId") REFERENCES "IssueRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
