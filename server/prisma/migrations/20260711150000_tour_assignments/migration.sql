-- Guide assignments — TourAssignment (staff member ↔ TourEvent, role on the
-- assignment). externalPersonId + displayName snapshots keep history readable
-- if the PersonRef row is ever deleted (SetNull). Purely additive.

CREATE TABLE IF NOT EXISTS "TourAssignment" (
    "id" TEXT NOT NULL,
    "tourEventId" TEXT NOT NULL,
    "personRefId" TEXT,
    "externalPersonId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TourAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TourAssignment_tourEventId_externalPersonId_key" ON "TourAssignment"("tourEventId", "externalPersonId");
CREATE INDEX IF NOT EXISTS "TourAssignment_tourEventId_idx" ON "TourAssignment"("tourEventId");
CREATE INDEX IF NOT EXISTS "TourAssignment_personRefId_idx" ON "TourAssignment"("personRefId");
CREATE INDEX IF NOT EXISTS "TourAssignment_externalPersonId_idx" ON "TourAssignment"("externalPersonId");

ALTER TABLE "TourAssignment"
  ADD CONSTRAINT "TourAssignment_tourEventId_fkey"
  FOREIGN KEY ("tourEventId") REFERENCES "TourEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TourAssignment"
  ADD CONSTRAINT "TourAssignment_personRefId_fkey"
  FOREIGN KEY ("personRefId") REFERENCES "PersonRef"("id") ON DELETE SET NULL ON UPDATE CASCADE;
