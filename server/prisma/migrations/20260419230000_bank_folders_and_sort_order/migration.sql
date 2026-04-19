-- Procedures pass: flat item-bank folders + explicit sortOrder on items/flows.
-- sortOrder is backfilled from existing createdAt ranks so current visual
-- order is preserved; new rows are appended by picking max+1 client-side.

-- Folders: flat (no parentId in V1).
CREATE TABLE "ItemBankFolder" (
    "id"        TEXT         NOT NULL,
    "name"      TEXT         NOT NULL,
    "sortOrder" INTEGER      NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemBankFolder_pkey" PRIMARY KEY ("id")
);

-- Items: nullable folderId + sortOrder.
ALTER TABLE "ContentItem"
    ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "folderId"  TEXT;
CREATE INDEX "ContentItem_folderId_sortOrder_idx"
    ON "ContentItem"("folderId", "sortOrder");
ALTER TABLE "ContentItem"
    ADD CONSTRAINT "ContentItem_folderId_fkey"
    FOREIGN KEY ("folderId") REFERENCES "ItemBankFolder"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "QuestionItem"
    ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "folderId"  TEXT;
CREATE INDEX "QuestionItem_folderId_sortOrder_idx"
    ON "QuestionItem"("folderId", "sortOrder");
ALTER TABLE "QuestionItem"
    ADD CONSTRAINT "QuestionItem_folderId_fkey"
    FOREIGN KEY ("folderId") REFERENCES "ItemBankFolder"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Flows: sortOrder on the top-level flows list.
ALTER TABLE "Flow"
    ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- Backfill sortOrder from createdAt rank so oldest items are first (sortOrder
-- ascending), matching the new default ordering rule.
UPDATE "ContentItem" SET "sortOrder" = ranks.rnk
  FROM (
    SELECT id, (ROW_NUMBER() OVER (ORDER BY "createdAt" ASC) - 1) AS rnk
    FROM "ContentItem"
  ) AS ranks
  WHERE "ContentItem"."id" = ranks.id;

UPDATE "QuestionItem" SET "sortOrder" = ranks.rnk
  FROM (
    SELECT id, (ROW_NUMBER() OVER (ORDER BY "createdAt" ASC) - 1) AS rnk
    FROM "QuestionItem"
  ) AS ranks
  WHERE "QuestionItem"."id" = ranks.id;

UPDATE "Flow" SET "sortOrder" = ranks.rnk
  FROM (
    SELECT id, (ROW_NUMBER() OVER (ORDER BY "createdAt" ASC) - 1) AS rnk
    FROM "Flow"
  ) AS ranks
  WHERE "Flow"."id" = ranks.id;
