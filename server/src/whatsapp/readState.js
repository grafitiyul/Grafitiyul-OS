// Canonical WhatsApp read-state service (server SSOT). One place that answers
// "mark this chat read / unread", used by the inbox, the Deal dock and the
// Contact/Org panels — so no surface can disagree, and there is exactly one
// read model (retiring the per-device localStorage seenStore).
//
// Model — a monotonic per-chat READ WATER-MARK (WhatsAppChat.lastReadAt):
//   • an incoming message is UNREAD iff its timestampFromSource > lastReadAt
//   • unreadCount is the cached count, maintained by the bridge on ingest
//   • manualUnreadAt is the WhatsApp-style "mark unread" DISPLAY flag only
// Reading (here) advances lastReadAt to the newest message (GREATEST — never
// backwards), zeroes unreadCount, clears the manual flag, AND best-effort tells
// WhatsApp via the bridge so the phone/other devices clear too. The WhatsApp
// receipt is fire-and-forget: GOS read state stands regardless, and reconnect
// reconciliation (bridge onHistorySync) repairs the WhatsApp side if it missed.
//
// Dependency-injected (prisma, bridge) so it unit-tests without a live DB or a
// real bridge — the same pattern as whatsapp/send.js.

// Bound the receipts we send: WhatsApp acks the newest and prior messages, so a
// window is plenty and keeps a huge backlog from flooding the socket.
const MAX_RECEIPT_KEYS = 100;

// Advance the water-mark to the newest message and clear unread. Monotonic:
// GREATEST(existing, lastMessageAt) can only move lastReadAt forward, so a
// stale/racing read can never rewind it or clear a newer message.
const ADVANCE_READ_SQL = `
  UPDATE "WhatsAppChat"
     SET "lastReadAt" = GREATEST(COALESCE("lastReadAt"::timestamptz, '-infinity'::timestamptz), COALESCE("lastMessageAt"::timestamptz, now())),
         "unreadCount" = 0,
         "manualUnreadAt" = NULL
   WHERE "id" = $1`;

// Build the read-receipt keys the bridge needs. Private chats don't need a
// participant; group senders do (WhatsApp requires it) — taken from the stored
// rawPayload key. Drops rows without an external id or (for groups) without a
// resolvable participant. Pure + exported for tests.
export function buildReceiptKeys(messages, isGroup) {
  const keys = [];
  for (const m of messages || []) {
    if (!m.externalMessageId) continue;
    if (isGroup) {
      const participant = m.rawPayload?.key?.participant ?? null;
      if (!participant) continue; // can't ack a group message without its sender
      keys.push({ id: m.externalMessageId, participant });
    } else {
      keys.push({ id: m.externalMessageId });
    }
  }
  return keys;
}

// Mark a chat read: advance the water-mark + clear count/manual flag, then
// best-effort push read receipts to WhatsApp. Returns { ok, marked } — `marked`
// is how many receipts were sent to the bridge (0 when nothing was unread or
// the bridge is unreachable).
export async function markChatRead(chatId, { prisma, bridge = null, log = null } = {}) {
  const chat = await prisma.whatsAppChat.findUnique({
    where: { id: chatId },
    select: { id: true, accountId: true, externalChatId: true, type: true, lastReadAt: true },
  });
  if (!chat) return { ok: false, reason: 'not_found', marked: 0 };

  const isGroup = chat.type === 'group';
  // Unread incoming messages (strictly newer than the CURRENT water-mark), read
  // BEFORE we advance it. Bounded, newest-first.
  const unread = await prisma.whatsAppMessage.findMany({
    where: {
      chatId,
      direction: 'incoming',
      externalMessageId: { not: null },
      ...(chat.lastReadAt ? { timestampFromSource: { gt: chat.lastReadAt } } : {}),
    },
    orderBy: { timestampFromSource: 'desc' },
    take: MAX_RECEIPT_KEYS,
    select: { externalMessageId: true, rawPayload: isGroup },
  });

  await prisma.$executeRawUnsafe(ADVANCE_READ_SQL, chatId);

  const keys = buildReceiptKeys(unread, isGroup);
  if (keys.length && bridge) {
    try {
      await bridge(chat.accountId, '/mark-read', {
        method: 'POST',
        body: { jid: chat.externalChatId, keys },
      });
    } catch (err) {
      // Soft failure — GOS read state already advanced; WhatsApp side is
      // reconciled on the next reconnect history sync.
      log?.warn?.({ chatId, err: err?.message || String(err) }, 'bridge mark-read failed (soft)');
    }
  }
  return { ok: true, marked: keys.length };
}

// Manual "mark as unread" — a DISPLAY flag only. It does NOT rewind the water-
// mark (so honest counts stay honest); the row simply renders unread until any
// real read clears it. Mirrors WhatsApp's own manual-unread behaviour.
export async function markChatUnread(chatId, { prisma } = {}) {
  await prisma.whatsAppChat.updateMany({
    where: { id: chatId },
    data: { manualUnreadAt: new Date() },
  });
  return { ok: true };
}
