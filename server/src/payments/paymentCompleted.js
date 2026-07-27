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
 * Fire-and-forget: never throws into the payment path.
 */
export function emitPaymentCompleted(
  { dealId, amountMinor, currency = 'ILS', provider, reference, source = PAYMENT_SOURCE_LINK },
  log = console,
) {
  if (!dealId) return;
  const amount = amountMinor == null ? null : Number(amountMinor);
  const idempotencyKey = `${provider}:${dealId}:${reference || amount || 'payment'}`;

  // Communication Center — editable customer/internal templates.
  fireCommunicationTrigger({
    type: 'payment_received',
    dealId,
    triggerRef: idempotencyKey,
    data: { completedAmountMinor: amount, currency, provider, source, reference: reference || null },
  }, log);

  // Admin Report #1 — code-managed internal notification. Only link payments.
  if (source === PAYMENT_SOURCE_LINK) {
    fireAdminReport({
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
