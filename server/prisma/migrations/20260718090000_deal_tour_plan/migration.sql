-- Deal Tour PLANNING (pre-WON) — the canonical planning entity for a
-- private/business deal's future tour: planned team, planned activity
-- components + workshop locations, operational notes. Strictly internal
-- (no TourEvent, no calendar, no guide visibility) until WON materializes it.
-- Purely additive — three new tables only.
-- ON DELETE: plan Cascades with the deal; child rows Cascade with the plan;
-- personRef is SetNull (snapshot columns keep history readable); catalog FKs
-- are Restrict (entries are deactivated, never hard-deleted while referenced).

CREATE TABLE IF NOT EXISTS "DealTourPlan" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "notes" TEXT,
    "componentsCustomized" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DealTourPlan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DealTourPlan_dealId_key" ON "DealTourPlan"("dealId");

ALTER TABLE "DealTourPlan"
  ADD CONSTRAINT "DealTourPlan_dealId_fkey"
  FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "DealTourPlanAssignment" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "personRefId" TEXT,
    "externalPersonId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DealTourPlanAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DealTourPlanAssignment_planId_externalPersonId_key" ON "DealTourPlanAssignment"("planId", "externalPersonId");
CREATE INDEX IF NOT EXISTS "DealTourPlanAssignment_planId_idx" ON "DealTourPlanAssignment"("planId");
CREATE INDEX IF NOT EXISTS "DealTourPlanAssignment_personRefId_idx" ON "DealTourPlanAssignment"("personRefId");

ALTER TABLE "DealTourPlanAssignment"
  ADD CONSTRAINT "DealTourPlanAssignment_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "DealTourPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DealTourPlanAssignment"
  ADD CONSTRAINT "DealTourPlanAssignment_personRefId_fkey"
  FOREIGN KEY ("personRefId") REFERENCES "PersonRef"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "DealTourPlanActivityComponent" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "activityComponentId" TEXT NOT NULL,
    "workshopLocationId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DealTourPlanActivityComponent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DealTourPlanActivityComponent_planId_activityComponentId_key" ON "DealTourPlanActivityComponent"("planId", "activityComponentId");
CREATE INDEX IF NOT EXISTS "DealTourPlanActivityComponent_planId_idx" ON "DealTourPlanActivityComponent"("planId");
CREATE INDEX IF NOT EXISTS "DealTourPlanActivityComponent_activityComponentId_idx" ON "DealTourPlanActivityComponent"("activityComponentId");
CREATE INDEX IF NOT EXISTS "DealTourPlanActivityComponent_workshopLocationId_idx" ON "DealTourPlanActivityComponent"("workshopLocationId");

ALTER TABLE "DealTourPlanActivityComponent"
  ADD CONSTRAINT "DealTourPlanActivityComponent_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "DealTourPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DealTourPlanActivityComponent"
  ADD CONSTRAINT "DealTourPlanActivityComponent_activityComponentId_fkey"
  FOREIGN KEY ("activityComponentId") REFERENCES "ActivityComponent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DealTourPlanActivityComponent"
  ADD CONSTRAINT "DealTourPlanActivityComponent_workshopLocationId_fkey"
  FOREIGN KEY ("workshopLocationId") REFERENCES "WorkshopLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
