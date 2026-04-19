-- Bilingual business fields: each field carries Hebrew + English values.
-- The old `value` column migrates into `valueHe`; `valueEn` starts empty.
-- DocumentField gets a `language` selector so placements can render either.
--
-- Steps run atomically under Prisma's migration transaction. Order matters:
-- add new columns first, backfill from old, then drop old.

-- 1. Add the two language columns with safe defaults.
ALTER TABLE "BusinessField"
    ADD COLUMN "valueHe" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "valueEn" TEXT NOT NULL DEFAULT '';

-- 2. Backfill Hebrew column from existing monolingual `value`.
UPDATE "BusinessField" SET "valueHe" = "value";

-- 3. Drop the old column.
ALTER TABLE "BusinessField" DROP COLUMN "value";

-- 4. Language selector on placements. Default Hebrew so existing rows keep
--    rendering exactly as before.
ALTER TABLE "DocumentField"
    ADD COLUMN "language" TEXT NOT NULL DEFAULT 'he';
