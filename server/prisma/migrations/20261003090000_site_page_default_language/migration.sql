-- Per-page default public language (he | en). Additive, backfills 'he' which
-- matches the behavior every existing page already had.
ALTER TABLE "SitePage" ADD COLUMN "defaultLanguage" TEXT NOT NULL DEFAULT 'he';
