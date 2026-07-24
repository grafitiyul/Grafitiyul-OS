-- Canonical agent-reservation summary document: exactly one immutable PDF per
-- successfully processed ReservationSession. sessionId UNIQUE is the
-- idempotency anchor (rerun/retry can never create a second document).
CREATE TABLE "ReservationDocument" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'agent_summary',
    "language" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
    "sizeBytes" INTEGER NOT NULL,
    "pdfBytes" BYTEA NOT NULL,
    "contentSnapshot" JSONB NOT NULL,
    "generatorVersion" TEXT NOT NULL DEFAULT 'v1',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReservationDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReservationDocument_sessionId_key" ON "ReservationDocument"("sessionId");

ALTER TABLE "ReservationDocument" ADD CONSTRAINT "ReservationDocument_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ReservationSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
