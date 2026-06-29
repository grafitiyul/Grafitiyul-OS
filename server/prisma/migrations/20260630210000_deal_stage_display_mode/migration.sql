-- DealStage: platform inline-edit Display Mode (read | edit). ADDITIVE, defaulted.
-- 'read' = Read First (click-to-edit); 'edit' = Edit First (fields open as inputs).
-- Existing stages default to 'read'. Safe to re-run.

ALTER TABLE "DealStage" ADD COLUMN IF NOT EXISTS "displayMode" TEXT NOT NULL DEFAULT 'read';
