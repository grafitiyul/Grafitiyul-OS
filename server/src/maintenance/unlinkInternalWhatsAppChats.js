// Idempotent sweep: internal WhatsApp chats must carry NO customer link.
//
// Production incident #26316 (2026-08-05): the internal conversation between
// our two business numbers (מכירות ↔ שירות לקוחות) carried contactId=<customer>
// with matchSource='phone'. chatDisplayName puts the linked Contact's name
// above every other identity source, so the Deal panel presented our own
// office number as the customer on the מכירות account and three operator
// messages went to the office instead of the customer.
//
// The rule (enforced going forward by whatsapp/selfIdentity.js guards in every
// link path + the bridge merge): a private chat whose REMOTE side is one of
// our own connected accounts' numbers is internal — it must never be linked
// to a Contact. This sweep repairs any row that violates it, on every boot,
// so a link that sneaks in through any future writer heals within one deploy.
//
// Touches ONLY contactId/matchSource (link-only, reversible by design —
// the schema's own contract). Messages, timestamps, media, receipts, account
// ownership: untouched. No chat is deleted or merged.

import { ownAccountPhoneSet, isInternalRemote } from '../whatsapp/selfIdentity.js';

export async function unlinkInternalWhatsAppChats(client, { log = console } = {}) {
  const ownNumbers = await ownAccountPhoneSet({ db: client, fresh: true });
  if (ownNumbers.size === 0) return { skipped: 'no_account_numbers_known' };

  const linked = await client.whatsAppChat.findMany({
    where: { type: 'private', contactId: { not: null } },
    select: {
      id: true, accountId: true, type: true, externalChatId: true,
      phoneNumber: true, phoneJid: true, lidJid: true,
      contactId: true, matchSource: true,
    },
  });
  const offenders = linked.filter((c) => isInternalRemote(c, ownNumbers));
  if (offenders.length === 0) return { repaired: 0 };

  for (const chat of offenders) {
    log.warn?.(
      `[unlink-internal-wa] chat ${chat.id} (${chat.accountId} → ${chat.phoneNumber || chat.externalChatId}) ` +
      `was linked to contact ${chat.contactId} (${chat.matchSource}) — unlinking (internal business number)`,
    );
  }
  const res = await client.whatsAppChat.updateMany({
    where: { id: { in: offenders.map((c) => c.id) } },
    data: { contactId: null, matchSource: null },
  });
  log.log?.(`[unlink-internal-wa] unlinked ${res.count} internal chat(s) from contacts`);
  return { repaired: res.count, chatIds: offenders.map((c) => c.id) };
}
