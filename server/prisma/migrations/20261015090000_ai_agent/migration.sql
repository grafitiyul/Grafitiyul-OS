-- סוכן AI — the controlled operational WhatsApp agent.
--
-- Purely ADDITIVE: nine NEW tables, no existing column dropped, no existing row
-- rewritten, nothing existing changes meaning. Every table is empty on deploy
-- and the module ships with AgentSettings.enabled = false, so applying this
-- migration changes zero runtime behaviour anywhere in GOS.
--
-- See docs/architecture/GOS-ai-agent-architecture-2026-08-08.md

-- ── Operational configuration (singleton) ───────────────────────────────────
-- `enabled` is a KILL SWITCH FOR ANALYSIS, deliberately NOT an authority
-- control: turning it on grants no permission to anything, because every
-- capability still carries its own mode in AgentCapabilityState.
CREATE TABLE "AgentSettings" (
  "id"                   TEXT NOT NULL DEFAULT 'singleton',
  "enabled"              BOOLEAN NOT NULL DEFAULT false,
  "provider"             TEXT NOT NULL DEFAULT 'anthropic',
  "model"                TEXT NOT NULL DEFAULT 'claude-opus-5',
  "effort"               TEXT NOT NULL DEFAULT 'medium',
  "includeGroups"        BOOLEAN NOT NULL DEFAULT false,
  "maxMessageAgeMinutes" INTEGER NOT NULL DEFAULT 180,
  "recentMessageCount"   INTEGER NOT NULL DEFAULT 20,
  "maxRunsPerSweep"      INTEGER NOT NULL DEFAULT 10,
  "updatedAt"            TIMESTAMP(3) NOT NULL,
  "updatedById"          TEXT,
  CONSTRAINT "AgentSettings_pkey" PRIMARY KEY ("id")
);

-- ── Authority: operator-chosen mode for a CODE-defined capability ───────────
-- No FK by design: capability identity lives in
-- server/src/agent/capabilities/registry.js. A row whose key no longer exists
-- in code is ignored on read, so removing a capability needs no data migration.
CREATE TABLE "AgentCapabilityState" (
  "key"         TEXT NOT NULL,
  "mode"        TEXT NOT NULL,
  "conditions"  JSONB,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  "updatedById" TEXT,
  CONSTRAINT "AgentCapabilityState_pkey" PRIMARY KEY ("key")
);

-- ── Approved business knowledge ─────────────────────────────────────────────
CREATE TABLE "AgentKnowledgeItem" (
  "id"              TEXT NOT NULL,
  "title"           TEXT NOT NULL,
  "body"            TEXT NOT NULL,
  "category"        TEXT NOT NULL,
  "language"        TEXT NOT NULL DEFAULT 'both',
  "scope"           JSONB,
  "status"          TEXT NOT NULL DEFAULT 'draft',
  "sortOrder"       INTEGER NOT NULL DEFAULT 0,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  "createdById"     TEXT,
  "approvedById"    TEXT,
  "approvedAt"      TIMESTAMP(3),
  "archivedAt"      TIMESTAMP(3),
  "sourceInsightId" TEXT,
  CONSTRAINT "AgentKnowledgeItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentKnowledgeItem_status_category_idx"
  ON "AgentKnowledgeItem" ("status", "category");

-- ── Approved way of working ─────────────────────────────────────────────────
CREATE TABLE "AgentPlaybookRule" (
  "id"              TEXT NOT NULL,
  "title"           TEXT NOT NULL,
  "whenText"        TEXT NOT NULL,
  "thenText"        TEXT NOT NULL,
  "category"        TEXT NOT NULL,
  "language"        TEXT NOT NULL DEFAULT 'both',
  "scope"           JSONB,
  "priority"        INTEGER NOT NULL DEFAULT 100,
  "status"          TEXT NOT NULL DEFAULT 'draft',
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  "createdById"     TEXT,
  "approvedById"    TEXT,
  "approvedAt"      TIMESTAMP(3),
  "archivedAt"      TIMESTAMP(3),
  "sourceInsightId" TEXT,
  CONSTRAINT "AgentPlaybookRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentPlaybookRule_status_category_idx"
  ON "AgentPlaybookRule" ("status", "category");

-- ── How we sound ────────────────────────────────────────────────────────────
CREATE TABLE "AgentStyleProfile" (
  "id"              TEXT NOT NULL,
  "key"             TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "language"        TEXT NOT NULL,
  "audience"        TEXT NOT NULL,
  "rules"           JSONB NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'draft',
  "isDefault"       BOOLEAN NOT NULL DEFAULT false,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  "createdById"     TEXT,
  "approvedById"    TEXT,
  "approvedAt"      TIMESTAMP(3),
  "archivedAt"      TIMESTAMP(3),
  "sourceInsightId" TEXT,
  CONSTRAINT "AgentStyleProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentStyleProfile_key_key" ON "AgentStyleProfile" ("key");
CREATE INDEX "AgentStyleProfile_status_language_audience_idx"
  ON "AgentStyleProfile" ("status", "language", "audience");

-- ── Content-addressed frozen configuration ──────────────────────────────────
-- Same active configuration → same hash → one row reused, so this grows only
-- when an operator actually changes something. It is what makes "which rules
-- were active when this historical answer was generated" answerable forever.
CREATE TABLE "AgentConfigSnapshot" (
  "id"         TEXT NOT NULL,
  "hash"       TEXT NOT NULL,
  "payload"    JSONB NOT NULL,
  "itemCounts" JSONB,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentConfigSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentConfigSnapshot_hash_key" ON "AgentConfigSnapshot" ("hash");
CREATE INDEX "AgentConfigSnapshot_createdAt_idx" ON "AgentConfigSnapshot" ("createdAt");

-- ── One analysis attempt ────────────────────────────────────────────────────
-- The (chatId, triggerMessageId) unique is the idempotency identity: the sweep
-- re-examines an overlapping window every pass, and re-seeing a mirrored
-- message must never produce a second run or a second proposal.
CREATE TABLE "AgentRun" (
  "id"               TEXT NOT NULL,
  "trigger"          TEXT NOT NULL,
  "status"           TEXT NOT NULL DEFAULT 'pending',
  "accountId"        TEXT,
  "chatId"           TEXT,
  "triggerMessageId" TEXT,
  "contactId"        TEXT,
  "dealId"           TEXT,
  "authorityMode"    TEXT,
  "provider"         TEXT,
  "model"            TEXT,
  "promptVersion"    TEXT,
  "configSnapshotId" TEXT,
  "contextSources"   JSONB,
  "contextPack"      JSONB,
  "intent"           TEXT,
  "capabilityKey"    TEXT,
  "confidence"       TEXT,
  "escalate"         BOOLEAN NOT NULL DEFAULT false,
  "escalationReason" TEXT,
  "guardFindings"    JSONB,
  "latencyMs"        INTEGER,
  "inputTokens"      INTEGER,
  "outputTokens"     INTEGER,
  "errorCode"        TEXT,
  "errorMessage"     TEXT,
  "skipReason"       TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentRun_chatId_triggerMessageId_key"
  ON "AgentRun" ("chatId", "triggerMessageId");
CREATE INDEX "AgentRun_createdAt_idx"         ON "AgentRun" ("createdAt");
CREATE INDEX "AgentRun_status_createdAt_idx"  ON "AgentRun" ("status", "createdAt");
CREATE INDEX "AgentRun_chatId_createdAt_idx"  ON "AgentRun" ("chatId", "createdAt");
CREATE INDEX "AgentRun_dealId_idx"            ON "AgentRun" ("dealId");

-- SET NULL, not CASCADE: a snapshot must never be able to delete the history
-- that references it, and a run with no snapshot is still honest history.
ALTER TABLE "AgentRun"
  ADD CONSTRAINT "AgentRun_configSnapshotId_fkey"
  FOREIGN KEY ("configSnapshotId") REFERENCES "AgentConfigSnapshot"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── What the agent would say, and what a human did about it ─────────────────
-- proposedText is IMMUTABLE by contract (enforced in the service): an operator
-- edit writes finalText. Overwriting the proposal would destroy the only
-- training signal this module exists to collect.
CREATE TABLE "AgentProposal" (
  "id"                 TEXT NOT NULL,
  "runId"              TEXT NOT NULL,
  "kind"               TEXT NOT NULL DEFAULT 'reply',
  "capabilityKey"      TEXT,
  "proposedText"       TEXT,
  "proposedActions"    JSONB,
  "status"             TEXT NOT NULL DEFAULT 'shadow',
  "finalText"          TEXT,
  "handledById"        TEXT,
  "handledAt"          TIMESTAMP(3),
  "rejectReason"       TEXT,
  "fpLastMessageId"    TEXT,
  "fpLastMessageAt"    TIMESTAMP(3),
  "fpMessageCount"     INTEGER,
  "fpDealUpdatedAt"    TIMESTAMP(3),
  "idempotencyKey"     TEXT NOT NULL,
  "scheduledMessageId" TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentProposal_pkey" PRIMARY KEY ("id")
);

-- The send endpoint CLAIMS this key, so two operators approving the same
-- suggestion produce exactly one outbound message.
CREATE UNIQUE INDEX "AgentProposal_idempotencyKey_key"
  ON "AgentProposal" ("idempotencyKey");
CREATE INDEX "AgentProposal_status_createdAt_idx"
  ON "AgentProposal" ("status", "createdAt");
CREATE INDEX "AgentProposal_runId_idx" ON "AgentProposal" ("runId");
CREATE INDEX "AgentProposal_capabilityKey_status_idx"
  ON "AgentProposal" ("capabilityKey", "status");

ALTER TABLE "AgentProposal"
  ADD CONSTRAINT "AgentProposal_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "AgentRun"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Proposed learning (never applied automatically) ─────────────────────────
CREATE TABLE "AgentInsight" (
  "id"               TEXT NOT NULL,
  "category"         TEXT NOT NULL,
  "title"            TEXT NOT NULL,
  "proposedChange"   TEXT NOT NULL,
  "rationale"        TEXT,
  "strength"         TEXT NOT NULL DEFAULT 'initial',
  "evidenceCount"    INTEGER NOT NULL DEFAULT 0,
  "evidenceRefs"     JSONB,
  "status"           TEXT NOT NULL DEFAULT 'open',
  "appliedRecordId"  TEXT,
  "reviewedById"     TEXT,
  "reviewedAt"       TIMESTAMP(3),
  "reviewNote"       TEXT,
  "generatedByRunId" TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentInsight_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentInsight_status_category_idx" ON "AgentInsight" ("status", "category");
CREATE INDEX "AgentInsight_createdAt_idx"       ON "AgentInsight" ("createdAt");
