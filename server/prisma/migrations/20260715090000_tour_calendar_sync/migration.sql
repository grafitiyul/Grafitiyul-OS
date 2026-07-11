-- Google Calendar mirror for tours: event identity + sync outbox state on
-- TourEvent, and a tombstone table so deleting a tour still cancels its
-- Google event asynchronously.

-- AlterTable
ALTER TABLE "TourEvent" ADD COLUMN "gcalEventId" TEXT,
ADD COLUMN "gcalAccountId" TEXT,
ADD COLUMN "gcalSyncStatus" TEXT,
ADD COLUMN "gcalSyncError" TEXT,
ADD COLUMN "gcalSyncWarning" TEXT,
ADD COLUMN "gcalSyncedAt" TIMESTAMP(3),
ADD COLUMN "gcalAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "gcalNextRetryAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "TourEvent_gcalSyncStatus_gcalNextRetryAt_idx" ON "TourEvent"("gcalSyncStatus", "gcalNextRetryAt");

-- CreateTable
CREATE TABLE "TourCalendarTombstone" (
    "id" TEXT NOT NULL,
    "tourEventId" TEXT NOT NULL,
    "gcalEventId" TEXT NOT NULL,
    "gcalAccountId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TourCalendarTombstone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TourCalendarTombstone_status_nextRetryAt_idx" ON "TourCalendarTombstone"("status", "nextRetryAt");
