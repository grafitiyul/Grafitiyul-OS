// THE way a server-initiated message reaches a CUSTOMER on WhatsApp.
//
// Nothing here talks to Baileys. A customer message is handed to the existing
// WhatsAppScheduledMessage queue, which already owns — correctly, in one place —
// customer sending windows, provider-disconnection deferral, the retry ladder,
// pacing, attachments and delivery logging. Re-implementing any of that per
// feature is how a second, weaker sender gets born.
//
// Extracted from adminReports/customerDelivery.js when the new-lead automatic
// reply needed the same transport. Both callers now share ONE definition of:
//   • the normalized destination (canonical normalizePhoneIntl → JID)
//   • the sending account (canonical resolveSendAccount — explicit, then the
//     operator/system default, then the only configured bridge; it THROWS on
//     ambiguity rather than picking a business number for us)
//   • thread continuity (an existing private chat on that account wins)
//   • the customer sending-window policy (personRefId stays null — that is what
//     marks a row as a customer rather than a staff send)

import { phoneToJid } from './send.js';
import { resolveSendAccount } from './senderAccount.js';
import { normalizePhoneIntl } from './phone.js';

/**
 * Queue one customer WhatsApp message.
 *
 * Returns a discriminated result instead of throwing, because every caller has
 * its own ledger row to stamp with the reason:
 *   { ok: true,  scheduledMessageId, accountId, phoneIntl, chatId }
 *   { ok: false, reason: 'invalid_phone' | 'no_account' | 'empty_content' }
 *
 * @param {object} db      prisma client (or a transaction/test double)
 * @param {object} params
 * @param {string} params.phone            raw phone, any stored format
 * @param {string} params.text             final WhatsApp markup — already rendered
 * @param {string|null} [params.explicitAccountId]  a decided account, if any
 * @param {Array}  [params.attachments]    R2 attachment refs
 * @param {boolean}[params.bypassWindow]   frozen onto the row at enqueue
 * @param {string|null} [params.createdById] provenance label for the queue row
 * @param {Date}   [params.scheduledAt]    default: now
 */
export async function enqueueCustomerWhatsApp(db, {
  phone,
  text,
  explicitAccountId = null,
  attachments = [],
  bypassWindow = false,
  createdById = null,
  scheduledAt = null,
}) {
  const content = String(text ?? '');
  if (!content.trim()) return { ok: false, reason: 'empty_content' };

  const phoneIntl = normalizePhoneIntl(phone);
  const jid = phoneIntl ? phoneToJid(phoneIntl) : null;
  if (!jid) return { ok: false, reason: 'invalid_phone' };

  // The canonical resolver returns { accountId, reason } and THROWS when two
  // numbers are configured and nothing selected one. Ambiguity is never
  // resolved by preference order, so a throw becomes an honest skip here.
  let accountId = null;
  try {
    accountId = resolveSendAccount({ explicit: explicitAccountId }).accountId;
  } catch {
    accountId = null;
  }
  if (!accountId) return { ok: false, reason: 'no_account' };

  // An existing customer chat keeps thread continuity; without one the queue
  // sends to the JID directly (the same shape the staff-send path uses).
  const chat = await db.whatsAppChat.findFirst({
    where: { accountId, phoneNumber: phoneIntl, type: 'private' },
    select: { id: true },
  });

  const row = await db.whatsAppScheduledMessage.create({
    data: {
      accountId,
      chatId: chat?.id || null,
      destinationJid: jid,
      destinationPhone: phoneIntl,
      // NO personRefId: that is what marks a row as a STAFF send. Null resolves
      // to the 'customer' sending-window policy, which is the whole reason a
      // customer message goes through this queue.
      personRefId: null,
      attachments: attachments.length ? attachments : null,
      bypassSendingWindow: !!bypassWindow,
      content,
      scheduledAt: scheduledAt || new Date(),
      createdById,
    },
    select: { id: true },
  });

  return { ok: true, scheduledMessageId: row.id, accountId, phoneIntl, chatId: chat?.id || null };
}
