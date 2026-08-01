-- Manager reports gain an email channel.
--
-- Reports were WhatsApp-only (callBridge + waAccountId/waChatId). The daily
-- review digest is an email, so the channel becomes explicit rather than
-- assumed. Defaulting to 'whatsapp' leaves every existing configured report
-- behaving exactly as before — this migration changes no behaviour on its own.

ALTER TABLE "AdminReportConfig"
  ADD COLUMN IF NOT EXISTS "channel"             TEXT    NOT NULL DEFAULT 'whatsapp',
  ADD COLUMN IF NOT EXISTS "emailAccountId"      TEXT,
  ADD COLUMN IF NOT EXISTS "emailRecipients"     TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "useDefaultRecipient" BOOLEAN NOT NULL DEFAULT true;

-- The delivery row records which channel actually carried it, so the log and
-- the queue stay honest for mixed-channel history.
ALTER TABLE "AdminReportDelivery"
  ADD COLUMN IF NOT EXISTS "channel"         TEXT NOT NULL DEFAULT 'whatsapp',
  ADD COLUMN IF NOT EXISTS "emailAccountId"  TEXT,
  ADD COLUMN IF NOT EXISTS "recipientEmail"  TEXT,
  ADD COLUMN IF NOT EXISTS "renderedSubject" TEXT;

-- "שלח בשפת המדריך" — opt-in per report. Defaults to false, so every existing
-- report keeps sending in Hebrew until the office decides otherwise.
ALTER TABLE "AdminReportConfig"
  ADD COLUMN IF NOT EXISTS "sendInGuideLanguage" BOOLEAN NOT NULL DEFAULT false;
