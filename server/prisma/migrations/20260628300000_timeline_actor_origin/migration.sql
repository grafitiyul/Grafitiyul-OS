-- Timeline explicit origin (no anonymous items).
--
-- ADDITIVE ONLY. Adds an explicit origin to every timeline object:
--   actorType  — 'user' | 'api' | 'automation' | 'system' | 'import'
--   actorLabel — human-readable source label for non-'user' origins
-- Existing rows default to 'user' (they were all created by logged-in admins,
-- and already carry createdBy/createdByName). Defensive (IF NOT EXISTS) so it is
-- safe to re-run.

ALTER TABLE "TimelineEntry"   ADD COLUMN IF NOT EXISTS "actorType"  TEXT NOT NULL DEFAULT 'user';
ALTER TABLE "TimelineEntry"   ADD COLUMN IF NOT EXISTS "actorLabel" TEXT;
ALTER TABLE "TimelineComment" ADD COLUMN IF NOT EXISTS "actorType"  TEXT NOT NULL DEFAULT 'user';
ALTER TABLE "TimelineComment" ADD COLUMN IF NOT EXISTS "actorLabel" TEXT;
