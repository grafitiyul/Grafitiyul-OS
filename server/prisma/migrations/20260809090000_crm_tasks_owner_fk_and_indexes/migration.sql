-- CRM Tasks workspace — Slice 0 (model foundation). ADDITIVE ONLY.
-- Adds one nullable column, three indexes, and one foreign key. Drops nothing,
-- rewrites no rows, changes no existing behaviour. Idempotent so a re-apply is
-- harmless. See docs/architecture/GOS-crm-tasks-workspace-plan.md §5.5.

-- 1. AdminUser.displayName — the human-facing name. Nullable: readers fall back
-- to `username` via src/admin/displayName.js (the one resolver). Nothing is
-- backfilled; a null here is a legitimate "no display name set yet".
ALTER TABLE "AdminUser" ADD COLUMN IF NOT EXISTS "displayName" TEXT;

-- 2. CRM Tasks workspace access paths. The workspace query is always
-- "time window (a dueDate range) + filters, ordered by dueDate", which the
-- pre-existing indexes ([dealId, status], [ownerUserId, status]) cannot serve.
-- [ownerUserId, status] is now a strict prefix of the second index below and is
-- therefore redundant, but it is deliberately RETAINED so this migration stays
-- purely additive; dropping it belongs to a later dedicated cleanup.
CREATE INDEX IF NOT EXISTS "Task_status_dueDate_idx"
    ON "Task" ("status", "dueDate");
CREATE INDEX IF NOT EXISTS "Task_ownerUserId_status_dueDate_idx"
    ON "Task" ("ownerUserId", "status", "dueDate");
CREATE INDEX IF NOT EXISTS "Task_taskTypeId_status_dueDate_idx"
    ON "Task" ("taskTypeId", "status", "dueDate");

-- 3. Task.ownerUserId becomes a REAL foreign key.
--
-- ON DELETE RESTRICT (not SetNull): an admin who still owns tasks cannot be
-- physically deleted until those tasks are reassigned. This keeps "ownerUserId"
-- NON-NULL, preserving the always-set assumption that taskService and every
-- existing reader already rely on. Retiring a person is `isActive = false`,
-- which leaves them a valid, resolvable owner of their task history forever.
--
-- SAFETY: every existing non-null ownerUserId was audited against AdminUser
-- before this migration was written (2026-07-15: 7 tasks, 1 distinct owner,
-- 0 null/empty, 0 orphaned). A non-resolving value would make this statement
-- fail during `prisma migrate deploy`, which runs at Railway startup — i.e. it
-- would take the service down. It was verified first, not assumed.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Task_ownerUserId_fkey'
    ) THEN
        ALTER TABLE "Task"
            ADD CONSTRAINT "Task_ownerUserId_fkey"
            FOREIGN KEY ("ownerUserId") REFERENCES "AdminUser"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
