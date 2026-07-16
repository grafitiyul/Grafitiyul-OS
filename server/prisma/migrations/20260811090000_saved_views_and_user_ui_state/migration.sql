-- CRM Tasks workspace — Slice 5 (Saved Views). ADDITIVE ONLY.
-- Two new tables, their indexes, and their FKs. Touches no existing table, no
-- existing row. Idempotent so a re-apply is harmless.
-- See docs/architecture/GOS-crm-tasks-workspace-plan.md §5.4.

-- Workspace presets. `filters` stores the canonical filter object VERBATIM
-- (including the selected time chip), `sort` the multi-sort list, `columns` an
-- optional table-layout snapshot. scope: personal | shared | system.
CREATE TABLE IF NOT EXISTS "SavedView" (
    "id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "scope" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "filters" JSONB NOT NULL,
    "sort" JSONB NOT NULL,
    "columns" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SavedView_module_key_key"
    ON "SavedView" ("module", "key");
CREATE INDEX IF NOT EXISTS "SavedView_module_scope_idx"
    ON "SavedView" ("module", "scope");
CREATE INDEX IF NOT EXISTS "SavedView_ownerUserId_idx"
    ON "SavedView" ("ownerUserId");

-- Per-user cross-device UI state (first key: 'crm_tasks.lastView').
CREATE TABLE IF NOT EXISTS "UserUiState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserUiState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserUiState_userId_key_key"
    ON "UserUiState" ("userId", "key");

-- Preferences Cascade with their owner (unlike Task ownership, which is
-- Restrict): a deleted admin's views/state are not auditable records.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'SavedView_ownerUserId_fkey'
    ) THEN
        ALTER TABLE "SavedView"
            ADD CONSTRAINT "SavedView_ownerUserId_fkey"
            FOREIGN KEY ("ownerUserId") REFERENCES "AdminUser"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'UserUiState_userId_fkey'
    ) THEN
        ALTER TABLE "UserUiState"
            ADD CONSTRAINT "UserUiState_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "AdminUser"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
