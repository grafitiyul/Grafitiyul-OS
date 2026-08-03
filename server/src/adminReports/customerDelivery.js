// Customer-audience reports — code-defined content, shared-queue transport.
//
// ── Why these do not send directly ───────────────────────────────────────────
// Every other report calls the WhatsApp bridge itself. That is fine for an
// internal group: the office is awake when the office is awake, and an internal
// alert has no media. A CUSTOMER message is different on three counts —
// customer sending windows, provider-disconnection deferral, and attachments —
// and all three already exist, correctly, in the WhatsAppScheduledMessage
// queue. Reimplementing them here would have produced a second, weaker copy.
//
// So the split is:
//   AdminReportDelivery  — the business event: exactly-once, frozen text, audit
//   WhatsAppScheduledMessage — the transport: windows, deferral, retries, media
//
// The unique (reportNumber, idempotencyKey) index remains the ONLY thing
// standing between a replay and a second message to a real customer. The queue
// row is created only after that index has admitted the event.

import { prisma } from '../db.js';
import { phoneToJid } from '../whatsapp/send.js';
import { resolveSendAccount } from '../whatsapp/senderAccount.js';
import { normalizePhoneIntl } from '../whatsapp/phone.js';

/**
 * Hand a frozen customer message to the shared queue.
 *
 * `delivery` is the already-created AdminReportDelivery row (the idempotency
 * gate). Returns { ok, reason } — never throws into the caller, because a
 * follow-up message must not be able to fail a guide's form submission.
 */
export async function enqueueCustomerMessage(delivery, { attachments = [], bypassWindow = false } = {}, log = console) {
  try {
    const phoneIntl = normalizePhoneIntl(delivery.recipientPhone);
    const jid = phoneIntl ? phoneToJid(phoneIntl) : null;
    if (!jid) {
      await prisma.adminReportDelivery.update({
        where: { id: delivery.id },
        data: { status: 'failed_final', lastError: 'מספר הטלפון של הלקוח אינו תקין' },
      });
      return { ok: false, reason: 'bad_phone' };
    }

    // The report's configured account wins; otherwise the canonical resolver
    // decides and THROWS on ambiguity rather than guessing a business number.
    let accountId = null;
    try {
      accountId = resolveSendAccount({ explicit: delivery.waAccountId || null });
    } catch { accountId = null; }
    if (!accountId) {
      await prisma.adminReportDelivery.update({
        where: { id: delivery.id },
        data: { status: 'failed_final', lastError: 'לא הוגדר חשבון WhatsApp לשליחה' },
      });
      return { ok: false, reason: 'no_account' };
    }

    // An existing customer chat keeps thread continuity; without one the queue
    // sends to the JID directly (the same shape the staff-send path uses).
    const chat = await prisma.whatsAppChat.findFirst({
      where: { accountId, phoneNumber: phoneIntl, type: 'private' },
      select: { id: true },
    });

    const row = await prisma.whatsAppScheduledMessage.create({
      data: {
        accountId,
        chatId: chat?.id || null,
        destinationJid: jid,
        destinationPhone: phoneIntl,
        // NO personRefId: that is what marks a row as a staff send. A customer
        // row resolves to the 'customer' sending-window policy, which is the
        // whole reason this goes through the queue.
        personRefId: null,
        attachments: attachments.length ? attachments : null,
        bypassSendingWindow: !!bypassWindow,
        content: delivery.renderedText || '',
        scheduledAt: new Date(),
        createdById: `admin-report:${delivery.reportNumber}`,
      },
      select: { id: true },
    });

    await prisma.adminReportDelivery.update({
      where: { id: delivery.id },
      data: { status: 'queued', scheduledMessageId: row.id },
    });
    return { ok: true, scheduledMessageId: row.id };
  } catch (err) {
    log.error?.(`[admin-reports] customer enqueue failed: ${err?.message || err}`);
    await prisma.adminReportDelivery
      .update({
        where: { id: delivery.id },
        data: { status: 'failed', lastError: String(err?.message || err).slice(0, 400) },
      })
      .catch(() => {});
    return { ok: false, reason: 'error' };
  }
}
