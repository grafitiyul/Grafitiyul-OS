-- Flow-level settings for Management Tasks → tour summary → "הודעה למדריך".
--
-- "Which of our numbers do we write to guides from" is a property of the FLOW,
-- not of each wording. It lived on WhatsAppTemplate.sendAccountId for one
-- release; this moves it to one place the operator sets once.
CREATE TABLE "GuideMessageSettings" (
  "id"            TEXT NOT NULL DEFAULT 'singleton',
  "sendAccountId" TEXT,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  "updatedById"   TEXT,
  CONSTRAINT "GuideMessageSettings_pkey" PRIMARY KEY ("id")
);

-- Seed the singleton with the answer today: 'office' = שירות לקוחות. Stored as
-- the canonical account ID, never the label, so renaming the number in admin
-- cannot change which number sends.
INSERT INTO "GuideMessageSettings" ("id", "sendAccountId", "updatedAt")
VALUES ('singleton', 'office', NOW())
ON CONFLICT ("id") DO NOTHING;

-- Drop the per-template sending number. Verified against production before
-- writing this: ZERO rows ever carried a non-null value, so there is nothing
-- to migrate and nothing to lose. The new-lead account column
-- (newLeadSendAccountId) is a DIFFERENT flow and is deliberately untouched.
ALTER TABLE "WhatsAppTemplate" DROP COLUMN IF EXISTS "sendAccountId";
