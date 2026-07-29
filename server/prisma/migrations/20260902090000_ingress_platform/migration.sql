-- Ingress Platform — the canonical pipeline store for every external
-- lead/order source (Meta Lead Ads, WooCommerce, website/Elementor forms).
--
-- IngressEvent persists the RAW payload before any processing, so every inbound
-- lead is replayable from source truth. (source, idempotencyKey) is unique:
-- provider retries, double submits and replays can never process twice.
-- contactId/organizationId/dealId are intentionally NOT foreign keys — the
-- audit trail outlives the records it created.
--
-- Additive only — no existing table is touched.
CREATE TABLE "IngressEvent" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceKey" TEXT,
    "externalId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "rawPayload" JSONB NOT NULL,
    "rawHeaders" JSONB,
    "normalized" JSONB,
    "attribution" JSONB,
    "dedupeKey" TEXT,
    "contactId" TEXT,
    "organizationId" TEXT,
    "dealId" TEXT,
    "outcome" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "claimedBy" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "IngressEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IngressEvent_source_idempotencyKey_key" ON "IngressEvent"("source", "idempotencyKey");

CREATE INDEX "IngressEvent_status_nextRetryAt_idx" ON "IngressEvent"("status", "nextRetryAt");

CREATE INDEX "IngressEvent_source_receivedAt_idx" ON "IngressEvent"("source", "receivedAt");

CREATE INDEX "IngressEvent_dedupeKey_idx" ON "IngressEvent"("dedupeKey");

CREATE INDEX "IngressEvent_dealId_idx" ON "IngressEvent"("dealId");

-- One row per processing attempt — the observability/audit spine.
CREATE TABLE "IngressAttempt" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "stage" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngressAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IngressAttempt_eventId_attemptNo_idx" ON "IngressAttempt"("eventId", "attemptNo");

ALTER TABLE "IngressAttempt" ADD CONSTRAINT "IngressAttempt_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "IngressEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
