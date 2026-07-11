-- Guide → training-content Station permission rows (מערכי הדרכה). Explicit
-- per-station grants are the single source of truth; bulk tour actions only
-- create/delete rows. Enforced server-side on guide portal training routes.

-- CreateTable
CREATE TABLE "GuideStationAccess" (
    "stationId" TEXT NOT NULL,
    "personRefId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuideStationAccess_pkey" PRIMARY KEY ("stationId","personRefId")
);

-- CreateIndex
CREATE INDEX "GuideStationAccess_personRefId_idx" ON "GuideStationAccess"("personRefId");

-- AddForeignKey
ALTER TABLE "GuideStationAccess" ADD CONSTRAINT "GuideStationAccess_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "TourStation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuideStationAccess" ADD CONSTRAINT "GuideStationAccess_personRefId_fkey" FOREIGN KEY ("personRefId") REFERENCES "PersonRef"("id") ON DELETE CASCADE ON UPDATE CASCADE;
