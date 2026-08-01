-- Staff identity + preferred language, GOS-owned.
--
-- On PersonProfile, NOT PersonRef: PersonRef.displayName/email/phone are
-- overwritten by recruitment identity sync, and these must never be clobbered.
-- PersonProfile is documented as management-owned, so no sync can reach them.
-- When recruitment consolidates into GOS, PersonRef.displayName retires and
-- these stay canonical — no second identity model is needed.

ALTER TABLE "PersonProfile"
  ADD COLUMN IF NOT EXISTS "firstNameHe"       TEXT,
  ADD COLUMN IF NOT EXISTS "lastNameHe"        TEXT,
  ADD COLUMN IF NOT EXISTS "firstNameEn"       TEXT,
  ADD COLUMN IF NOT EXISTS "lastNameEn"        TEXT,
  ADD COLUMN IF NOT EXISTS "preferredLanguage" TEXT NOT NULL DEFAULT 'he';

-- Every existing staff member defaults to Hebrew (the column default already
-- does this for existing rows; stated explicitly so the intent is on record).
UPDATE "PersonProfile" SET "preferredLanguage" = 'he' WHERE "preferredLanguage" IS NULL;

-- Ensure every PersonRef has a profile row, so the staff editor always has
-- somewhere to write. Profiles are 1:1 and management-owned; creating an empty
-- one changes no behaviour.
INSERT INTO "PersonProfile" ("personRefId", "preferredLanguage")
SELECT pr."id", 'he'
FROM "PersonRef" pr
LEFT JOIN "PersonProfile" pp ON pp."personRefId" = pr."id"
WHERE pp."personRefId" IS NULL;

-- Best-effort backfill of the Hebrew name from the legacy single-string
-- displayName: first token = first name, the rest = surname. Right for the
-- overwhelming majority of Hebrew names.
--
-- NON-DESTRUCTIVE: PersonRef.displayName is NOT modified, and the resolver
-- (shared/staffName.mjs) still falls back to it. A wrong split therefore costs
-- one edit in the staff screen, never data. English names are deliberately left
-- empty — inventing a transliteration would be worse than an honest blank.
UPDATE "PersonProfile" pp
SET
  "firstNameHe" = NULLIF(split_part(btrim(pr."displayName"), ' ', 1), ''),
  "lastNameHe"  = NULLIF(btrim(substring(btrim(pr."displayName") FROM position(' ' IN btrim(pr."displayName")) + 1)), '')
FROM "PersonRef" pr
WHERE pp."personRefId" = pr."id"
  AND pp."firstNameHe" IS NULL
  AND btrim(COALESCE(pr."displayName", '')) <> ''
  -- Only split when there IS a space; a single-token name becomes the first
  -- name alone via the same expression.
  AND position(' ' IN btrim(pr."displayName")) > 0;

-- Single-token display names: first name only, no surname invented.
UPDATE "PersonProfile" pp
SET "firstNameHe" = btrim(pr."displayName")
FROM "PersonRef" pr
WHERE pp."personRefId" = pr."id"
  AND pp."firstNameHe" IS NULL
  AND btrim(COALESCE(pr."displayName", '')) <> '';
