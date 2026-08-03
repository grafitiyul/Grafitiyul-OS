// THE canonical "an online payment was completed" event.
//
// Before this module, payment completion had TWO disconnected endings:
//   * iCount IPN → captured a document and fired the Communication Center
//     trigger (unverified payload, and the ONLY path that notified anything),
//   * Cardcom    → verified the payment properly (GetLpResult + atomic
//     pending→paid) but emitted NO completion event at all, so nothing could
//     ever react to a Cardcom payment.
// Every online payment-link provider now converges here, so downstream
// consumers (Communication Center trigger, Admin Report #1) see ONE event with
// one shape — and a new provider is one more call site, not new logic.
//
// `source` is what makes Report #1 honest: only 'payment_link' completions —
// money the customer actually paid online through a GOS-generated link — reach
// it. Documents recorded by hand in the office never call this.
//
// `dealWasWonBeforePayment` is the second half of that honesty: Report #1
// means "a customer ADDED a payment to a closed deal". The payment that closed
// the deal in the first place is a WON transition, announced by Report #26 —
// firing both for the same payment would report one event twice. The flag is
// the deal's status BEFORE this payment's lifecycle effects (the settle
// result), never derived from the final status — deriving it later would make
// every payment look like it landed on an already-WON deal.

import { fireCommunicationTrigger } from '../communication/engine.js';
import { fireAdminReport } from '../adminReports/dispatch.js';

export const PAYMENT_SOURCE_LINK = 'payment_link';

/**
 * Announce a completed online payment.
 *   dealId        — the deal that was paid (canonical)
 *   amountMinor   — the amount ACTUALLY paid in this transaction (verified /
 *                   from the issued money document) — never the deal total
 *   currency, provider ('icount' | 'cardcom'), reference (docnum / txn id)
 *   source        — PAYMENT_SOURCE_LINK for customer-completed link payments
 *   dealWasWonBeforePayment — was the deal ALREADY WON before this payment's
 *                   lifecycle effects ran? Report #1 fires only when true.
 * Fire-and-forget: never throws into the payment path.
 */
export function emitPaymentCompleted(
  {
    dealId,
    amountMinor,
    currency = 'ILS',
    provider,
    reference,
    source = PAYMENT_SOURCE_LINK,
    dealWasWonBeforePayment = false,
  },
  log = console,
  { fireTrigger = fireCommunicationTrigger, fireReport = fireAdminReport } = {},
) {
  if (!dealId) return;
  const amount = amountMinor == null ? null : Number(amountMinor);
  const idempotencyKey = `${provider}:${dealId}:${reference || amount || 'payment'}`;

  // Communication Center — editable customer/internal templates. Deliberately
  // unchanged by the WON split: "payment received" is true either way.
  fireTrigger({
    type: 'payment_received',
    dealId,
    triggerRef: idempotencyKey,
    data: { completedAmountMinor: amount, currency, provider, source, reference: reference || null },
  }, log);

  // Admin Report #1 — a NEW payment on an ALREADY-WON deal, through a link.
  // The payment that itself closed the deal is announced by Report #26 instead.
  if (source === PAYMENT_SOURCE_LINK && dealWasWonBeforePayment === true) {
    fireReport({
      number: 1,
      idempotencyKey,
      dealId,
      data: {
        payment: { completedAmountMinor: amount, currency },
        paymentMeta: { provider, reference: reference || null, source },
      },
    }, log).catch(() => {});
  }
}
