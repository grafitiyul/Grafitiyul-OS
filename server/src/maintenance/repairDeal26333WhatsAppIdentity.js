// One-time, idempotent repair of Deal #26333's WhatsApp identity.
//
// THE FACT (production audit, 2026-08-02): the customer is Mexican. His real
// WhatsApp number is +52 1 555 178 0355 — proven by the live 62-message
// conversation with our 'main' number at externalChatId
// 5215551780355@s.whatsapp.net (customer messages incoming as recently as
// today). His ContactPhone rows, however, stored the same digits under an
// ISRAELI prefix: '+9725551780355' (primary) and '05551780355' — an impossible
// Israeli shape (972 + 10 digits).
//
// WHAT THAT BROKE (one cause, both symptoms):
//   * context-chats matched by the corrupt normalization, so the REAL chat
//     never linked → the Deal showed an empty conversation;
//   * /chats/ensure minted chats for 9725551780355@s.whatsapp.net on both
//     accounts and the bridge's onWhatsApp probe honestly answered that this
//     number is not registered → "המספר הזה לא רשום ב-WhatsApp".
//
// THE REPAIR:
//   1. primary ContactPhone value → '+5215551780355' (the number WhatsApp
//      itself proved);
//   2. the corrupt duplicate row ('05551780355') is removed;
//   3. the real chat is linked to the contact (matchSource='phone' — exactly
//      what the runtime pass produces once the phone is correct);
//   4. the two GOS-minted zero-message chats for the impossible JID are
//      removed — guarded: any message or scheduled row aborts the delete.
//
// Deliberately NOT done: no message is copied or moved, no conversation is
// created, no send is triggered, no Deal/timeline field is written. The
// structural half of the fix (normalizePhoneIntl rejecting impossible 972
// shapes) lives in src/whatsapp/phone.js.

export const DEAL_ORDER_NO = 26333;
const CORRUPT_INTL_DIGITS = '9725551780355';
const CORRUPT_LOCAL_DIGITS = '05551780355';
const REAL_PHONE_VALUE = '+5215551780355';
const REAL_CHAT_JID = '5215551780355@s.whatsapp.net';
const BOGUS_CHAT_JID = '9725551780355@s.whatsapp.net';

export async function repairDeal26333WhatsAppIdentity(client, { log = console, dryRun = false } = {}) {
  const deal = await client.deal.findFirst({
    where: { orderNo: DEAL_ORDER_NO },
    select: { id: true, contacts: { orderBy: { createdAt: 'asc' }, select: { contactId: true, isPrimary: true } } },
  });
  if (!deal) return { skipped: 'deal_not_found' };
  const contactId = deal.contacts.find((c) => c.isPrimary)?.contactId ?? deal.contacts[0]?.contactId;
  if (!contactId) return { skipped: 'no_contact' };

  const digitsOf = (v) => String(v || '').replace(/\D/g, '');
  const phones = await client.contactPhone.findMany({ where: { contactId } });
  const corruptPrimary = phones.find((p) => digitsOf(p.value) === CORRUPT_INTL_DIGITS);
  const corruptDup = phones.find((p) => digitsOf(p.value) === CORRUPT_LOCAL_DIGITS);
  const alreadyReal = phones.some((p) => digitsOf(p.value) === digitsOf(REAL_PHONE_VALUE));

  const realChat = await client.whatsAppChat.findUnique({
    where: { accountId_externalChatId: { accountId: 'main', externalChatId: REAL_CHAT_JID } },
    select: { id: true, contactId: true },
  });
  const bogusChats = await client.whatsAppChat.findMany({
    where: { externalChatId: BOGUS_CHAT_JID },
    select: { id: true, accountId: true, _count: { select: { messages: true, scheduledMessages: true } } },
  });

  // The real chat belonging to a DIFFERENT contact would mean the world changed
  // under this repair — never relink, report instead.
  if (realChat && realChat.contactId && realChat.contactId !== contactId) {
    log.warn?.(`[repair-26333-wa] real chat is linked to another contact (${realChat.contactId}) — refusing`);
    return { skipped: 'real_chat_linked_elsewhere' };
  }

  const plan = {
    fixPrimaryPhone: corruptPrimary && !alreadyReal ? corruptPrimary.id : null,
    dropDuplicatePhone: corruptDup?.id ?? null,
    linkRealChat: realChat && !realChat.contactId ? realChat.id : null,
    dropBogusChats: bogusChats.filter((c) => c._count.messages === 0 && c._count.scheduledMessages === 0).map((c) => c.id),
    bogusWithDependents: bogusChats.filter((c) => c._count.messages > 0 || c._count.scheduledMessages > 0).map((c) => c.id),
  };
  const nothingToDo =
    !plan.fixPrimaryPhone && !plan.dropDuplicatePhone && !plan.linkRealChat && plan.dropBogusChats.length === 0;
  if (nothingToDo) return { skipped: 'already_repaired', bogusWithDependents: plan.bogusWithDependents };
  if (dryRun) return { dryRun: true, plan };

  await client.$transaction(async (tx) => {
    if (plan.fixPrimaryPhone) {
      await tx.contactPhone.update({ where: { id: plan.fixPrimaryPhone }, data: { value: REAL_PHONE_VALUE } });
    }
    if (plan.dropDuplicatePhone) {
      await tx.contactPhone.delete({ where: { id: plan.dropDuplicatePhone } });
    }
    if (plan.linkRealChat) {
      await tx.whatsAppChat.update({
        where: { id: plan.linkRealChat },
        data: { contactId, matchSource: 'phone' },
      });
    }
    if (plan.dropBogusChats.length) {
      await tx.whatsAppChat.deleteMany({ where: { id: { in: plan.dropBogusChats }, messages: { none: {} } } });
    }
  });

  log.log?.(
    `[repair-26333-wa] phone ${plan.fixPrimaryPhone ? `→ ${REAL_PHONE_VALUE}` : 'already correct'}, ` +
    `dup ${plan.dropDuplicatePhone ? 'removed' : '—'}, real chat ${plan.linkRealChat ? 'linked' : 'already linked'}, ` +
    `${plan.dropBogusChats.length} bogus empty chat(s) removed` +
    (plan.bogusWithDependents.length ? `, ${plan.bogusWithDependents.length} bogus chat(s) kept (have rows)` : ''),
  );
  return { repaired: true, plan };
}
