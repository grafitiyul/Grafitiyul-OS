-- Sending window policy ("זמני שליחה") — windows keyed by audience × channel.
--
-- The Communication Center already had windows, but keyed per message and
-- honoured by one sender. This re-keys the SAME windows so every outgoing
-- message in GOS obeys one policy. The evaluator (communication/windows.js) is
-- unchanged.
--
-- Purely additive, and DELIBERATELY SEEDED AS DISABLED: creating rows with
-- enabled=false means behaviour is identical to today until an operator turns a
-- window on. A migration must never start silently holding back messages.

CREATE TABLE IF NOT EXISTS "SendingWindowPolicy" (
  "id"            TEXT NOT NULL,
  "audienceKind"  TEXT NOT NULL,
  "channel"       TEXT NOT NULL,
  "enabled"       BOOLEAN NOT NULL DEFAULT false,
  "windowId"      TEXT,
  "updatedBy"     TEXT,
  "updatedByName" TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SendingWindowPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SendingWindowPolicy_audienceKind_channel_key"
  ON "SendingWindowPolicy" ("audienceKind", "channel");

-- Loose FK: deleting a window must not delete the policy row; the resolver
-- reports "no window selected" and fails closed with a visible reason.
DO $$
BEGIN
  ALTER TABLE "SendingWindowPolicy"
    ADD CONSTRAINT "SendingWindowPolicy_windowId_fkey"
    FOREIGN KEY ("windowId") REFERENCES "CommunicationSendingWindow"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Seed the full 3×2 matrix, all disabled.
INSERT INTO "SendingWindowPolicy" ("id", "audienceKind", "channel", "enabled", "updatedAt")
SELECT
  'swp_' || a.kind || '_' || c.ch,
  a.kind,
  c.ch,
  false,
  NOW()
FROM (VALUES ('customer'), ('guide'), ('manager')) AS a(kind)
CROSS JOIN (VALUES ('whatsapp'), ('email')) AS c(ch)
ON CONFLICT ("audienceKind", "channel") DO NOTHING;

-- Queue visibility for the two schedulers that had no wait vocabulary. A
-- message held for a window is WAITING, not failing, and the operator must be
-- able to see why and until when.
ALTER TABLE "WhatsAppScheduledMessage"
  ADD COLUMN IF NOT EXISTS "waitReason"  TEXT,
  ADD COLUMN IF NOT EXISTS "effectiveAt" TIMESTAMP(3);

ALTER TABLE "ScheduledEmail"
  ADD COLUMN IF NOT EXISTS "waitReason"  TEXT,
  ADD COLUMN IF NOT EXISTS "effectiveAt" TIMESTAMP(3);

-- Admin reports gain the connection-deferral the other senders already have, so
-- a long provider outage can no longer exhaust their 6-attempt ladder and mark
-- internal reports permanently failed.
ALTER TABLE "AdminReportDelivery"
  ADD COLUMN IF NOT EXISTS "connectionDeferredCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "waitReason"              TEXT,
  ADD COLUMN IF NOT EXISTS "effectiveAt"             TIMESTAMP(3);
