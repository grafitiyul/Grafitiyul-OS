-- Teams are managed natively in this system — the recruitment system is
-- NOT a source of truth for teams or for guide-team relationships. Drop
-- the externalTeamId column (and its unique index) from TeamRef; the
-- internal cuid `id` remains the stable handle, and all downstream FKs
-- (PersonRef.teamRefId, FlowTargetTeam.teamRefId) already reference that.
--
-- No data migration needed: existing TeamRef rows stay intact, only the
-- (now-meaningless) external id column is removed.

DROP INDEX IF EXISTS "TeamRef_externalTeamId_key";
ALTER TABLE "TeamRef" DROP COLUMN IF EXISTS "externalTeamId";
