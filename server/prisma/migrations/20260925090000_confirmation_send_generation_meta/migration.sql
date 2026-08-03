-- Confirmation Email — QA/debug polish. One additive column: the immutable
-- "generated from" metadata (template name, library blocks used, active
-- fillers, language, test flag) frozen at send time. Necessary as a COLUMN
-- because the live template is mutable — deriving this later would lie about
-- historical sends. Admin archive view only; never rendered to customers.

ALTER TABLE "ConfirmationEmailSend" ADD COLUMN "generationMeta" JSONB;
