-- Provider-state layer for the communication modules (root-cause fix for
-- "GOS shows conversations the provider doesn't"). ADDITIVE only, defensive
-- (IF NOT EXISTS) so it is safe to re-run. No data is dropped: the mirror
-- keeps everything; these columns let the ACTIVE inbox track what Gmail /
-- WhatsApp would actually show today.
--
--   • EmailMessage.labelIds          — Gmail labels snapshot (kept current by
--                                      history labelAdded/labelRemoved). NULL
--                                      marks pre-column rows for reconcile.
--   • EmailMessage.providerDeletedAt — deleted in Gmail (row kept for CRM).
--   • EmailThread.inInbox            — any live message carries INBOX.
--   • WhatsAppChat.providerArchivedAt/providerDeletedAt — phone state from
--                                      the bridge (chats.update / chats.delete).
--   • WhatsAppChat.hiddenAt          — GOS-side manual hide (legacy cleanup).

-- ── EmailMessage ─────────────────────────────────────────────────────────────
ALTER TABLE "EmailMessage" ADD COLUMN IF NOT EXISTS "labelIds" JSONB;
ALTER TABLE "EmailMessage" ADD COLUMN IF NOT EXISTS "providerDeletedAt" TIMESTAMP(3);

-- ── EmailThread ──────────────────────────────────────────────────────────────
-- Default true: existing threads stay visible until the reconcile pass
-- classifies them from real labels (archived/artifact threads then drop out).
ALTER TABLE "EmailThread" ADD COLUMN IF NOT EXISTS "inInbox" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS "EmailThread_accountId_inInbox_lastMessageAt_idx"
  ON "EmailThread"("accountId", "inInbox", "lastMessageAt");

-- ── WhatsAppChat ─────────────────────────────────────────────────────────────
ALTER TABLE "WhatsAppChat" ADD COLUMN IF NOT EXISTS "providerArchivedAt" TIMESTAMP(3);
ALTER TABLE "WhatsAppChat" ADD COLUMN IF NOT EXISTS "providerDeletedAt" TIMESTAMP(3);
ALTER TABLE "WhatsAppChat" ADD COLUMN IF NOT EXISTS "hiddenAt" TIMESTAMP(3);
