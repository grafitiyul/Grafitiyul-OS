-- CreateTable
CREATE TABLE "OperationalIssue" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "sourceModule" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "entityRefs" JSONB NOT NULL DEFAULT '[]',
    "data" JSONB,
    "status" TEXT NOT NULL DEFAULT 'open',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolvedByName" TEXT,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationalIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OperationalIssue_status_severity_detectedAt_idx" ON "OperationalIssue"("status", "severity", "detectedAt");

-- CreateIndex
CREATE INDEX "OperationalIssue_dedupeKey_status_idx" ON "OperationalIssue"("dedupeKey", "status");

-- CreateIndex
CREATE INDEX "OperationalIssue_sourceModule_status_idx" ON "OperationalIssue"("sourceModule", "status");

-- CreateIndex
CREATE INDEX "OperationalIssue_type_status_idx" ON "OperationalIssue"("type", "status");
