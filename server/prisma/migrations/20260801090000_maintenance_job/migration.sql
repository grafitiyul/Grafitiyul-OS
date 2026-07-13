-- Durable one-time maintenance-job marker (versioned backfills/reconciliations).
-- Purely additive. The row makes a job run exactly once across restarts and
-- across multiple instances (concurrency-safe claim in application code).
CREATE TABLE IF NOT EXISTS "MaintenanceJob" (
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MaintenanceJob_pkey" PRIMARY KEY ("key")
);
