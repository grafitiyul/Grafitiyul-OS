-- Legacy Mirror transport — the durable spine of the one-way mirror.
--
-- MirrorEvent persists the RAW payload BEFORE any processing (the same
-- discipline as IngressEvent), so a bug, an outage or a bad mapping is always
-- replayable from source truth. It is a separate table from IngressEvent
-- because the semantics differ: ingress CREATES records from a lead, the mirror
-- UPDATES existing ones through a 3-way merge and may correctly write nothing.
--
-- MirrorCursor holds polling position per (system, entity). Polling is the
-- BACKSTOP that keeps the mirror correct when a webhook is missed, delayed or
-- never configured — and it is the only reliable way to observe deletions.
--
-- Additive only — no existing table is touched.
CREATE TABLE "MirrorEvent" (
    "id" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "changeKind" TEXT NOT NULL,
    "transport" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "rawPayload" JSONB NOT NULL,
    "rawHeaders" JSONB,
    "outcome" TEXT,
    "gosEntityType" TEXT,
    "gosEntityId" TEXT,
    "fieldsWritten" JSONB,
    "conflicts" JSONB,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "claimedBy" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "MirrorEvent_pkey" PRIMARY KEY ("id")
);

-- Replay key: a provider retry, a webhook redelivery and a poll that re-sees
-- the same version can never process twice.
CREATE UNIQUE INDEX "MirrorEvent_system_idempotencyKey_key" ON "MirrorEvent"("system", "idempotencyKey");
CREATE INDEX "MirrorEvent_status_nextRetryAt_idx" ON "MirrorEvent"("status", "nextRetryAt");
CREATE INDEX "MirrorEvent_system_entity_receivedAt_idx" ON "MirrorEvent"("system", "entity", "receivedAt");
CREATE INDEX "MirrorEvent_gosEntityType_gosEntityId_idx" ON "MirrorEvent"("gosEntityType", "gosEntityId");
CREATE INDEX "MirrorEvent_outcome_idx" ON "MirrorEvent"("outcome");

CREATE TABLE "MirrorCursor" (
    "id" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "cursor" TEXT,
    "claimedAt" TIMESTAMP(3),
    "claimedBy" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "failureStreak" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MirrorCursor_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MirrorCursor_system_entity_idx" ON "MirrorCursor"("system", "entity");
