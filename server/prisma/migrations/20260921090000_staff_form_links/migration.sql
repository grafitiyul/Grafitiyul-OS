-- Staff form-scoped questionnaire links.
--
-- SECURITY FIX. Messages #12-#16 sent guides a link of the shape
--   /p/<portalToken>/tour/<tourEventId>
-- which IS the guide's whole-portal token with a path appended. Truncating the
-- path yields /p/<portalToken> — the entire portal: every tour, profile,
-- payments, training and schedule. Anyone the message was forwarded to had full
-- access, and because authorization is by token possession, hiding navigation
-- would have changed nothing.
--
-- A staff link authorizes EXACTLY ONE questionnaire instance and nothing else.
--
-- `audience` keeps the two surfaces apart: the public customer resolver keeps
-- rejecting staff purposes (it always did), and the new staff resolver accepts
-- ONLY audience='staff' rows. Neither token type can be used on the other's
-- route.
--
-- `actorScope` scopes a per-actor form (tour_summary) to ONE guide, so guide A's
-- link can never open guide B's summary.

ALTER TABLE "QuestionnaireLink"
  ADD COLUMN IF NOT EXISTS "audience"   TEXT NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS "actorScope" TEXT;

-- One link per business identity, so retries and re-sends REUSE the same link
-- instead of minting a new token every time a reminder fires.
-- NULLS NOT DISTINCT: a null actorScope (coordination) must still collide.
CREATE UNIQUE INDEX IF NOT EXISTS "QuestionnaireLink_staff_form_identity_key"
  ON "QuestionnaireLink" ("purpose", "subjectType", "subjectId", "actorScope", "audience")
  NULLS NOT DISTINCT;
