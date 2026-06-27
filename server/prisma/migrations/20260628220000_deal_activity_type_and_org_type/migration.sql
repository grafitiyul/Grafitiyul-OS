-- Deal: activity classification + direct organization type.
--
-- ADDITIVE ONLY. Two new nullable columns on "Deal", one index, and a FK to the
-- existing "OrganizationType" catalog (ON DELETE SET NULL). Nothing is dropped.
--
--   • "activityType"        — group | private | business (validated at the API,
--                             no Postgres enum — project convention is strings).
--   • "organizationTypeId"  — the Deal's CURRENT org type, the source of truth
--                             ONLY while no Organization is linked. Once an
--                             Organization is linked, the API clears this and the
--                             Organization's own type becomes effective (no
--                             duplicate truth).
--
-- Written defensively (IF NOT EXISTS / guarded constraint) so it is safe to re-run.

-- ── New columns ─────────────────────────────────────────────────────────────
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "activityType" TEXT;
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "organizationTypeId" TEXT;

-- ── Index + FK ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "Deal_organizationTypeId_idx" ON "Deal"("organizationTypeId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Deal_organizationTypeId_fkey'
  ) THEN
    ALTER TABLE "Deal"
      ADD CONSTRAINT "Deal_organizationTypeId_fkey"
      FOREIGN KEY ("organizationTypeId") REFERENCES "OrganizationType"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
