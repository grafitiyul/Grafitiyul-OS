-- The read-only context block configuration for a questionnaire purpose.
-- Null means "use the catalog default", so every existing row keeps working
-- without a backfill and a deploy before anyone configures anything is safe.
ALTER TABLE "QuestionnairePurposeConfig" ADD COLUMN "contextFields" JSONB;
