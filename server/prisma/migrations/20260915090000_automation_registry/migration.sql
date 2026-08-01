-- Automation Registry — foundation (Slices 0 + 1).
--
-- Purely additive. Nothing executes off these tables yet: automations live in
-- code (server/src/automations/definitions/), and these rows hold only operator
-- config, execution facts and change history.

-- ── Slice 0: the manual "משמשת באוטומציות" business flag ─────────────────────
-- The form author's DECISION that a question is an automation extension point.
-- Not derived from the registry — a question may be flagged before any
-- automation exists. Defaults to false, so every existing question is unflagged.
ALTER TABLE "QuestionnaireQuestion"
  ADD COLUMN IF NOT EXISTS "automationFlag" BOOLEAN NOT NULL DEFAULT false;

-- ── Slice 1: registry tables ─────────────────────────────────────────────────

-- Operator on/off switch. No row = follow the definition's defaultEnabled.
CREATE TABLE IF NOT EXISTS "AutomationState" (
  "autId"         TEXT NOT NULL,
  "enabled"       BOOLEAN,
  "updatedBy"     TEXT,
  "updatedByName" TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AutomationState_pkey" PRIMARY KEY ("autId")
);

-- One row per execution attempt — the sole source of last-run / counts / errors.
CREATE TABLE IF NOT EXISTS "AutomationRun" (
  "id"             TEXT NOT NULL,
  "autId"          TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status"         TEXT NOT NULL,
  "reasonHe"       TEXT,
  "stoppedAt"      TEXT,
  "input"          JSONB,
  "actionResults"  JSONB,
  "dealId"         TEXT,
  "tourEventId"    TEXT,
  "submissionId"   TEXT,
  "durationMs"     INTEGER,
  "startedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt"     TIMESTAMP(3),
  CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

-- The idempotency contract: a replayed trigger hits this unique and is dropped.
CREATE UNIQUE INDEX IF NOT EXISTS "AutomationRun_idempotencyKey_key"
  ON "AutomationRun" ("idempotencyKey");
CREATE INDEX IF NOT EXISTS "AutomationRun_autId_startedAt_idx"
  ON "AutomationRun" ("autId", "startedAt");
CREATE INDEX IF NOT EXISTS "AutomationRun_autId_status_startedAt_idx"
  ON "AutomationRun" ("autId", "status", "startedAt");
CREATE INDEX IF NOT EXISTS "AutomationRun_submissionId_idx"
  ON "AutomationRun" ("submissionId");

-- Change history, including boot-time definition-drift detection.
CREATE TABLE IF NOT EXISTS "AutomationChange" (
  "id"        TEXT NOT NULL,
  "autId"     TEXT NOT NULL,
  "kind"      TEXT NOT NULL,
  "summaryHe" TEXT NOT NULL,
  "fromHash"  TEXT,
  "toHash"    TEXT,
  "actorId"   TEXT,
  "actorName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutomationChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AutomationChange_autId_createdAt_idx"
  ON "AutomationChange" ("autId", "createdAt");
