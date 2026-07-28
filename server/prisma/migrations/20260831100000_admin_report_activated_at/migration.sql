-- Activation floor: a per-tour notification never reports an event whose due
-- moment is before the report was switched on. Prevents a backlog burst the
-- first time a notification is enabled. Additive and nullable.
ALTER TABLE "AdminReportConfig" ADD COLUMN "activatedAt" TIMESTAMP(3);

-- Reports already enabled are treated as activated now, so today's history is
-- not replayed to guides when this ships.
UPDATE "AdminReportConfig" SET "activatedAt" = NOW() WHERE "enabled" = true;
