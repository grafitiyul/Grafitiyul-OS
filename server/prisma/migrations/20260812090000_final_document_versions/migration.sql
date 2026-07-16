-- FinalDocument versioning: every finalize now appends a new immutable
-- version row instead of the instance locking forever after the first one.

ALTER TABLE "FinalDocument" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "FinalDocument" ADD COLUMN "isCurrent" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "FinalDocument" ADD COLUMN "note" TEXT;
ALTER TABLE "FinalDocument" ADD COLUMN "generatedById" TEXT;
ALTER TABLE "FinalDocument" ADD COLUMN "generatedBy" TEXT;

-- Backfill existing rows: number per instance by generatedAt (oldest = 1);
-- only the newest row per instance stays current. V1 produced at most one
-- row per instance, so this is normally version=1/isCurrent=true, but the
-- window handles any historical multi-row instance safely.
WITH numbered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY "instanceId" ORDER BY "generatedAt" ASC, id ASC) AS rn,
    COUNT(*) OVER (PARTITION BY "instanceId") AS cnt
  FROM "FinalDocument"
)
UPDATE "FinalDocument" f
SET "version" = n.rn,
    "isCurrent" = (n.rn = n.cnt)
FROM numbered n
WHERE f.id = n.id;

CREATE UNIQUE INDEX "FinalDocument_instanceId_version_key"
  ON "FinalDocument"("instanceId", "version");
