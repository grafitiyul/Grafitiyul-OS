// Our OWN WhatsApp business numbers — THE canonical self-identity set.
//
// Production incident #26316: the long-running internal conversation between
// the two business numbers (מכירות ↔ שירות לקוחות) carried a customer
// contactId, so the Deal panel presented our own שירות לקוחות number as the
// customer and three operator messages went to the office instead of the
// customer. Nothing in the system knew "this remote party is US".
//
// The rule this module enforces everywhere:
//   a private chat whose REMOTE side is one of our own connected accounts'
//   numbers is an INTERNAL business-to-business conversation. It may exist,
//   it is mirrored like any chat, but it must NEVER be linked to a customer
//   Contact, offered as a customer conversation on a Deal, or auto-matched.
//
// Self identity is per connected account (WhatsAppAccount.phoneJid, written by
// each account's own bridge at pairing) — resolved fresh from the DB with a
// short cache, never hardcoded.

import { prisma as defaultPrisma } from '../db.js';

const CACHE_MS = 60_000;
let cache = { at: 0, set: new Set() };

/** '972533083321:57@s.whatsapp.net' → '972533083321' (device suffix dropped). */
export function jidDigits(jid) {
  const m = /^(\d+)(?::\d+)?@/.exec(String(jid || ''));
  return m ? m[1] : null;
}

/** Set of intl digits of ALL configured accounts' own numbers (cached 60s). */
export async function ownAccountPhoneSet({ db = defaultPrisma, fresh = false } = {}) {
  if (!fresh && cache.set.size && Date.now() - cache.at < CACHE_MS) return cache.set;
  const accounts = await db.whatsAppAccount.findMany({ select: { phoneJid: true } });
  const set = new Set();
  for (const a of accounts) {
    const d = jidDigits(a.phoneJid);
    if (d) set.add(d);
  }
  cache = { at: Date.now(), set };
  return set;
}

/** For tests: drop the cache. */
export function resetOwnAccountPhoneCache() {
  cache = { at: 0, set: new Set() };
}

/**
 * Is this private chat's REMOTE side one of our own business numbers?
 * Checks every identity facet the chat carries (phoneNumber, phoneJid,
 * externalChatId, lidJid) so a partially-learned row is still recognized.
 */
export function isInternalRemote(chat, ownSet) {
  if (!chat || chat.type !== 'private' || !ownSet || ownSet.size === 0) return false;
  const facets = [
    String(chat.phoneNumber || '').replace(/\D/g, '') || null,
    jidDigits(chat.phoneJid),
    String(chat.externalChatId || '').endsWith('@s.whatsapp.net')
      ? jidDigits(chat.externalChatId)
      : null,
    jidDigits(chat.lidJid),
  ];
  return facets.some((d) => d && ownSet.has(d));
}
