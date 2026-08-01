-- Retire the two obsolete legacy control issue families.
--
-- Verified against production on 2026-08-01 before writing this:
--   legacy_sync_conflict           2 open  (lastSeenAt frozen 2026-07-31 07:05 / 11:59)
--   legacy_tour_product_unmatched  0 open  (9 already resolved)
--   deal_tour_out_of_sync          2 open  (lastSeenAt minutes old — REAL, kept)
--
-- Both retired families belonged to the mirror period. Since the legacy cutover
-- (2026-07-31) GOS is the single source of truth and Pipedrive is create-only
-- lead ingress, so "which system holds the right value?" has one permanent
-- answer. The mirror no longer runs, so these rows could never auto-resolve —
-- they would sit open forever.
--
-- NON-DESTRUCTIVE: this is a lifecycle transition, not a delete. Every row is
-- preserved with its full history; only `status` moves to 'resolved' and the
-- reason is recorded in `resolution`, so the audit trail stays honest and the
-- change is reversible.

UPDATE "OperationalIssue"
SET "status"     = 'resolved',
    "resolvedAt" = NOW(),
    "resolution" = 'retired_legacy_type_2026_08_01'
WHERE "type" IN ('legacy_sync_conflict', 'legacy_tour_product_unmatched')
  AND "status" IN ('open', 'acknowledged');
