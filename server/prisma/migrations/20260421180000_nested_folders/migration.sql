-- Nested folders in the item bank.
-- Adds a self-referencing parentId to ItemBankFolder. Existing folders stay
-- at root level (parentId=null). Ordering continues to use sortOrder, but
-- it is now scoped per-parent — the application reindexes within a parent.
--
-- ON DELETE SET NULL: when a parent is deleted, its children float up to
-- root rather than cascading away. Items inside those children stay with
-- their folder (ContentItem/QuestionItem.folderId is not touched).

ALTER TABLE "ItemBankFolder"
    ADD COLUMN "parentId" TEXT;

ALTER TABLE "ItemBankFolder"
    ADD CONSTRAINT "ItemBankFolder_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "ItemBankFolder"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ItemBankFolder_parentId_sortOrder_idx"
    ON "ItemBankFolder"("parentId", "sortOrder");
