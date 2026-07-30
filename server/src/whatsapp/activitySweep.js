// WhatsApp → Deal activity sweep.
//
// WHY A SWEEP AND NOT A HOOK: WhatsApp messages are written by the BRIDGE
// services, which deliberately hold no CRM logic (they link chats to Contacts
// and stop there — "WhatsApp never creates or edits Contacts"). Deal
// attribution is CRM policy and belongs on the server, so the server watches
// the mirror instead of the bridge reaching across into deals. It also means
// no bridge deploy — and therefore no WhatsApp socket restart — is needed to
// change attribution rules.
//
// One pass every 60s:
//   1. take the messages mirrored since the last pass (bounded overlap),
//   2. reduce them to ONE newest timestamp per chat (a burst of 30 messages in
//      one conversation is one deal touch, not thirty),
//   3. resolve each chat's deals via the shared attribution rule and stamp.
//
// Idempotency is structural: touchDealActivity takes GREATEST, so re-seeing a
// message (restart, overlap window) can never move a deal forward twice or
// backwards. That is why the watermark can live in memory — the worst case
// after a restart is redoing a few harmless stamps.
//
// Cost: one indexed range read (@@index([accountId, createdAt])) plus a small
// number of contact→deal lookups, only for chats that actually saw traffic.

import { prisma } from '../db.js';
import { touchDealsForWhatsAppChat } from '../crm/conversationActivity.js';

const TICK_MS = 60_000;
// Re-examine a little history each pass so a message that landed mid-pass, or
// arrived slightly out of order, is never skipped. Redundant work is free here.
const OVERLAP_MS = 5 * 60_000;
// First pass after boot looks a little further back, to cover a deploy gap.
const BOOT_LOOKBACK_MS = 15 * 60_000;

export async function sweepOnce(since, { db = prisma, log = console } = {}) {
  const rows = await db.whatsAppMessage.findMany({
    where: { createdAt: { gt: since } },
    select: { chatId: true, timestampFromSource: true },
    orderBy: { createdAt: 'asc' },
    take: 5000,
  });
  if (rows.length === 0) return { chats: 0, deals: 0, messages: 0 };

  // Newest message timestamp per chat — one touch per conversation per pass.
  const newestByChat = new Map();
  for (const r of rows) {
    const prev = newestByChat.get(r.chatId);
    if (!prev || r.timestampFromSource > prev) newestByChat.set(r.chatId, r.timestampFromSource);
  }

  const chats = await db.whatsAppChat.findMany({
    where: { id: { in: [...newestByChat.keys()] } },
    select: { id: true, contactId: true },
  });

  let deals = 0;
  for (const chat of chats) {
    if (!chat.contactId) continue; // unmatched conversation — nothing to attribute
    try {
      deals += await touchDealsForWhatsAppChat(chat, newestByChat.get(chat.id), db);
    } catch (e) {
      log.warn?.(`[whatsapp-activity] chat ${chat.id} attribution failed: ${e?.message}`);
    }
  }
  return { chats: chats.length, deals, messages: rows.length };
}

export function startWhatsAppActivitySweep(log = console) {
  let watermark = new Date(Date.now() - BOOT_LOOKBACK_MS);
  let inFlight = false;
  const timer = setInterval(async () => {
    if (inFlight) return;
    inFlight = true;
    // Capture the cutoff BEFORE the query: anything written during the pass
    // stays in range for the next one (the overlap makes this belt-and-braces).
    const passStart = new Date();
    try {
      const out = await sweepOnce(watermark, { log });
      watermark = new Date(passStart.getTime() - OVERLAP_MS);
      if (out.deals > 0) {
        log.info(`[whatsapp-activity] ${out.messages} msgs → ${out.chats} chats → ${out.deals} deal stamps`);
      }
    } catch (err) {
      // Leave the watermark where it is so the next pass retries this window.
      log.error(`[whatsapp-activity] sweep failed: ${err?.message || err}`);
    } finally {
      inFlight = false;
    }
  }, TICK_MS);
  timer.unref?.();
  log.info('[whatsapp-activity] deal-activity sweep started (60s tick)');
  return timer;
}
