-- WhatsApp canonical read state — ADDITIVE ONLY. Adds three columns to
-- WhatsAppChat and one index. Drops nothing, changes no existing behaviour.
-- Idempotent (IF NOT EXISTS), so a re-apply is harmless.
--
-- Model: lastReadAt is a monotonic per-chat READ WATER-MARK — an incoming
-- message is unread iff timestampFromSource > lastReadAt. unreadCount is the
-- cached derivation maintained by the bridge. manualUnreadAt is the WhatsApp-
-- style manual "mark unread" display flag. See src/whatsapp/readState.js.

-- 1. The read water-mark. Nullable = "nothing read yet" (treated as epoch).
ALTER TABLE "WhatsAppChat" ADD COLUMN IF NOT EXISTS "lastReadAt" TIMESTAMP(3);

-- 2. Cached unread count. Default 0 so existing rows are immediately valid.
ALTER TABLE "WhatsAppChat" ADD COLUMN IF NOT EXISTS "unreadCount" INTEGER NOT NULL DEFAULT 0;

-- 3. Manual "mark unread" display flag (never inflates unreadCount).
ALTER TABLE "WhatsAppChat" ADD COLUMN IF NOT EXISTS "manualUnreadAt" TIMESTAMP(3);

-- 4. BACKFILL: clean slate. Every existing chat is considered read up to its
-- last message (history is NOT retroactively unread — the same rule the old
-- per-device store used: "first sight = now"). New unread accrues only from
-- live messages after this migration. Runs once; the WHERE keeps a re-apply
-- from clobbering read state written after the first deploy.
UPDATE "WhatsAppChat"
   SET "lastReadAt" = COALESCE("lastMessageAt", "updatedAt", CURRENT_TIMESTAMP)
 WHERE "lastReadAt" IS NULL;

-- 5. Inbox ordering already uses [accountId, lastMessageAt]; unread filtering
-- rides that. No extra index needed for the count itself (it is a plain column
-- read on rows already fetched for the list).
