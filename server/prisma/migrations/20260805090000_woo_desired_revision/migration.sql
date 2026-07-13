-- Canonical Woo sellable-state revision: wooDesiredRevision bumps on every
-- dirty-mark; wooSyncedRevision records what the worker actually synced. A
-- mismatch means "not truly synced" and the sweep re-pends it. Additive.
ALTER TABLE "TourEvent" ADD COLUMN IF NOT EXISTS "wooDesiredRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TourEvent" ADD COLUMN IF NOT EXISTS "wooSyncedRevision" INTEGER;
