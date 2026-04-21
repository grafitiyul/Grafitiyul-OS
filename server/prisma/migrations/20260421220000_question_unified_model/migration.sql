-- Unified question model: a single question can present choices AND/OR a
-- free-text field, with one `requirement` field driving validation.
--
-- Adds:
--   allowTextAnswer  BOOLEAN NOT NULL DEFAULT false
--   requirement      TEXT    NOT NULL DEFAULT 'optional'
--
-- Keeps `answerType` (deprecated) for one release cycle so a rollback
-- stays safe. A follow-up migration will drop it.
--
-- Data migration: map the old binary answerType to the new shape so
-- existing questions behave identically after this change.
--   answerType = 'single_choice' → allowTextAnswer = false, requirement = 'choice'
--   answerType = 'open_text'     → allowTextAnswer = true,  requirement = 'text'
--   anything else (defensive)    → allowTextAnswer = false, requirement = 'optional'

ALTER TABLE "QuestionItem"
    ADD COLUMN "allowTextAnswer" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "QuestionItem"
    ADD COLUMN "requirement" TEXT NOT NULL DEFAULT 'optional';

UPDATE "QuestionItem"
SET "allowTextAnswer" = FALSE, "requirement" = 'choice'
WHERE "answerType" = 'single_choice';

UPDATE "QuestionItem"
SET "allowTextAnswer" = TRUE, "requirement" = 'text'
WHERE "answerType" = 'open_text';
