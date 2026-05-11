-- Namespace existing legacy-guide externalPersonId values.
--
-- Background: the recruitment system now exposes a unified
-- /api/export/people endpoint that returns both legacy guides and
-- candidate-pipeline people. To keep the two id spaces distinct,
-- guides arrive as `guide:<id>` and candidates as `candidate:<id>`.
--
-- BEFORE this migration, GOS PersonRef rows imported through the old
-- /api/export/guides endpoint hold a bare-numeric `externalPersonId`
-- (e.g. "1", "42"). The next sync from the new endpoint would treat
-- those as different identities and CREATE duplicate rows for the
-- same humans, abandoning their existing portalToken / portalEnabled
-- / attempts.
--
-- This migration backfills the namespace in place:
--   * PersonRef.externalPersonId where it's a bare numeric string
--     becomes "guide:<n>".
--   * Attempt.externalPersonId is rewritten in lock-step so attempt
--     history stays linked to the same PersonRef across the rename.
--
-- Safety + idempotency:
--   * The regex anchors `^[0-9]+$` so we ONLY rewrite bare-numeric
--     values. Rows already prefixed with `guide:` / `candidate:` or
--     any other namespace are skipped.
--   * Re-running is a no-op: after the first pass, no bare-numeric
--     values remain so the WHERE clauses match nothing.
--   * Wrapped in a single transaction so a partial update can't
--     desync PersonRef and Attempt.
--
-- Operational fields that survive untouched on the renamed rows
-- (these never go through the WHERE clause; only externalPersonId
-- changes):
--   portalToken, portalEnabled, accessGrantedAt, accessRevokedAt,
--   status, teamRefId, PersonProfile, identitySource, displayName,
--   email, phone, identitySyncedAt, createdAt, updatedAt.

BEGIN;

UPDATE "PersonRef"
SET    "externalPersonId" = 'guide:' || "externalPersonId"
WHERE  "identitySource"   = 'recruitment'
  AND  "externalPersonId" ~ '^[0-9]+$';

UPDATE "Attempt"
SET    "externalPersonId" = 'guide:' || "externalPersonId"
WHERE  "externalPersonId" IS NOT NULL
  AND  "externalPersonId" ~ '^[0-9]+$';

COMMIT;
