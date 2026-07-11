-- Per-guide tour summaries: a per-actor singleton scope on submissions.
-- For purposes flagged perActor (tour_summary) each required guide files their
-- OWN submission; actorScope carries the guide's externalPersonId and joins
-- the singleton key. NULL for all other purposes (and for legacy shared
-- summaries, which stay readable). Purely additive.
ALTER TABLE "QuestionnaireSubmission" ADD COLUMN IF NOT EXISTS "actorScope" TEXT;
