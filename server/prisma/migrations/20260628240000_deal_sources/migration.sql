-- Deal Sources catalog + Deal.dealSourceId.
--
-- ADDITIVE ONLY. A new "DealSource" catalog table (admin-managed picklist for
-- how a lead arrived) plus one new nullable column + index + FK on "Deal"
-- (ON DELETE SET NULL). The existing free-text "Deal"."source" column is kept
-- as the OPTIONAL extra detail field. Nothing is dropped. Defensive
-- (IF NOT EXISTS / guarded) so it is safe to re-run.

-- ── DealSource catalog ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "DealSource" (
  "id"        TEXT NOT NULL,
  "label"     TEXT NOT NULL,
  "active"    BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DealSource_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DealSource_sortOrder_idx" ON "DealSource"("sortOrder");

-- ── Deal.dealSourceId ───────────────────────────────────────────────────────
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "dealSourceId" TEXT;

CREATE INDEX IF NOT EXISTS "Deal_dealSourceId_idx" ON "Deal"("dealSourceId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Deal_dealSourceId_fkey'
  ) THEN
    ALTER TABLE "Deal"
      ADD CONSTRAINT "Deal_dealSourceId_fkey"
      FOREIGN KEY ("dealSourceId") REFERENCES "DealSource"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
