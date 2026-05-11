-- People & Access unification — adds lifecycle + audit columns to
-- PersonRef. All nullable so existing rows are unaffected. Operational
-- semantics:
--   * lifecycleHint      — stable English value from the upstream
--                          recruitment feed ('trainee' / 'staff' /
--                          'evaluator'). The admin UI maps this to
--                          Hebrew labels; the server never reads
--                          display text.
--   * accessGrantedAt    — set whenever portalEnabled flips to true.
--   * accessRevokedAt    — set whenever portalEnabled flips to false.

ALTER TABLE "PersonRef"
  ADD COLUMN "lifecycleHint"   TEXT,
  ADD COLUMN "accessGrantedAt" TIMESTAMP(3),
  ADD COLUMN "accessRevokedAt" TIMESTAMP(3);
