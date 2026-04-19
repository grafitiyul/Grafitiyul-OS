-- DocumentTemplate.origin: tag templates as 'library' (user-facing, reusable)
-- or 'adhoc' (created silently by the upload flow for a single instance).
-- Existing rows default to 'library' so they stay visible after deploy.

ALTER TABLE "DocumentTemplate"
    ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'library';

CREATE INDEX "DocumentTemplate_origin_idx" ON "DocumentTemplate"("origin");
