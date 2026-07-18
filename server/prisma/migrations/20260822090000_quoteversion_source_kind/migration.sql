-- Historical commercial breakdown import (migration completion).
--
-- ADDITIVE ONLY. One nullable TEXT column on QuoteVersion. `sourceKind` marks
-- a version's provenance: NULL = a native GOS version; 'pipedrive_import' = a
-- READ-ONLY frozen historical breakdown migrated from Pipedrive (never
-- isWorking, never repriced, never affects Deal.valueMinor). A partial index
-- serves the "does this deal have a historical version?" lookup.

ALTER TABLE "QuoteVersion" ADD COLUMN IF NOT EXISTS "sourceKind" TEXT;

CREATE INDEX IF NOT EXISTS "QuoteVersion_dealId_sourceKind_idx"
  ON "QuoteVersion" ("dealId", "sourceKind");
