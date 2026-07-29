-- Mirror sync state on the existing LegacyRecord crosswalk.
--
-- syncBaseline is "what the source said the last time GOS and legacy agreed",
-- stored per FIELD. It is the third input of the 3-way merge and the only
-- reason the mirror can distinguish a human edit from a source edit. A 2-way
-- merge (source vs GOS) cannot, so it must either clobber humans or refuse
-- everything.
--
-- NULL baseline = never synced. The merge engine treats that as BOOTSTRAP —
-- adopt a baseline and write nothing — rather than declaring every differing
-- field a conflict, which on first run would raise tens of thousands of
-- conflicts indistinguishable from noise.
--
-- sourceDeletedAt records that a record vanished from the source. GOS never
-- deletes on this signal: legacy deletions are frequently accidental, and GOS
-- now owns operational history (payroll, guide-portal state, quotes) hanging
-- off these records.
--
-- Additive only — all three columns are nullable and no existing row changes.
ALTER TABLE "LegacyRecord" ADD COLUMN "syncBaseline" JSONB;
ALTER TABLE "LegacyRecord" ADD COLUMN "lastSyncedAt" TIMESTAMP(3);
ALTER TABLE "LegacyRecord" ADD COLUMN "sourceDeletedAt" TIMESTAMP(3);

-- Serves the poller's "records not examined since X, for this system" scan.
CREATE INDEX "LegacyRecord_sourceSystem_lastSyncedAt_idx"
  ON "LegacyRecord"("sourceSystem", "lastSyncedAt");

-- Serves the reconciler's "what disappeared from the source" review queue.
CREATE INDEX "LegacyRecord_sourceDeletedAt_idx" ON "LegacyRecord"("sourceDeletedAt");
