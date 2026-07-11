-- Tour-operational questionnaire lifecycle redesign: submissions for
-- tour-operational purposes (coordination, tour_summary) now follow the LIVE
-- published version and stay editable after submit; "frozenAt" marks the one
-- historical freeze point (set when the subject's tour closes — version is
-- pinned and answers are snapshotted at that moment). Purely additive.
ALTER TABLE "QuestionnaireSubmission" ADD COLUMN IF NOT EXISTS "frozenAt" TIMESTAMP(3);
