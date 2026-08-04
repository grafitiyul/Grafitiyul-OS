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
import { enqueueCustomerWhatsApp } from '../whatsapp/customerQueue.js';

// Destination resolution, account selection and the queue row itself now come
// from whatsapp/customerQueue.js — the same helper the new-lead automatic reply
// uses. Keeping a second copy here is what let a real bug live: this file used
// to assign the resolver's `{accountId, reason}` OBJECT to the row's accountId
// column, so every customer report failed at the Prisma layer instead of
// sending. One helper, one correct unwrap.

const FAILURE_TEXT = {
  invalid_phone: 'מספר הטלפון של הלקוח אינו תקין',
  no_account: 'לא הוגדר חשבון WhatsApp לשליחה',
  empty_content: 'אין תוכן לשליחה',
};

/**
 * Hand a frozen customer message to the shared queue.
 *
 * `delivery` is the already-created AdminReportDelivery row (the idempotency
 * gate). Returns { ok, reason } — never throws into the caller, because a
 * follow-up message must not be able to fail a guide's form submission.
 */
export async function enqueueCustomerMessage(delivery, { attachments = [], bypassWindow = false } = {}, log = console) {
  try {
    const queued = await enqueueCustomerWhatsApp(prisma, {
      phone: delivery.recipientPhone,
      text: delivery.renderedText || '',
      // The report's configured account wins; otherwise the canonical resolver
      // decides and refuses rather than guessing a business number.
      explicitAccountId: delivery.waAccountId || null,
      attachments,
      bypassWindow,
      createdById: `admin-report:${delivery.reportNumber}`,
    });

    if (!queued.ok) {
      await prisma.adminReportDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'failed_final',
          lastError: FAILURE_TEXT[queued.reason] || queued.reason,
        },
      });
      return { ok: false, reason: queued.reason };
    }

    await prisma.adminReportDelivery.update({
      where: { id: delivery.id },
      data: { status: 'queued', scheduledMessageId: queued.scheduledMessageId },
    });
    return { ok: true, scheduledMessageId: queued.scheduledMessageId };
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
