import { createTourForWonDeal } from '../tours/tourFromDeal.js';
import { findHeldRegistrationForDeal } from '../tours/registrationLifecycle.js';
import { REG_EXPIRED } from '../tours/registrationStatus.js';
import { emitTimelineEvent, systemOrigin } from '../timeline/events.js';

// THE one canonical WON transition every completion mode funnels through —
// verified payment (pay-now / late payment) AND register-without-payment. No WON
// logic is duplicated in payment handlers or the completion routes.
//
// Idempotent: a deal already WON is a no-op. Runs the EXISTING WON pipeline
// (createTourForWonDeal) once, which — via syncDealRegistration's adoption —
// CONFIRMS the deal's existing HELD/EXPIRED reservation in place (same row,
// never a duplicate). Late payment (hold already expired) is accepted with
// overbook rather than rejected. `confirmation` stamps the money state on the
// confirmed registration: { paymentStatus, noPaymentReason }.
export async function settleDealWon(
  client,
  { dealId, targetTourEventId = null, allowOverbook = false, origin, paymentStatus = 'paid', noPaymentReason = null } = {},
) {
  const runOrigin = origin || systemOrigin();
  return client.$transaction(async (tx) => {
    const deal = await tx.deal.findUnique({ where: { id: dealId } });
    if (!deal) {
      const e = new Error('deal_not_found');
      e.code = 'deal_not_found';
      throw e;
    }
    if (deal.status === 'won') return { dealId, alreadyWon: true };

    // Target tour: explicit (no-payment picks it directly) else the deal's held/
    // lately-expired reservation's tour (pay-now / send-link created it).
    const held =
      (await findHeldRegistrationForDeal(tx, dealId)) ||
      (await tx.ticketRegistration.findFirst({ where: { dealId, status: REG_EXPIRED }, orderBy: { createdAt: 'desc' } }));
    const tourEventId = targetTourEventId || held?.tourEventId || null;
    const lateExpired = !targetTourEventId && held?.status === REG_EXPIRED;
    const effectiveOverbook = allowOverbook || lateExpired;

    await tx.deal.update({ where: { id: dealId }, data: { status: 'won' } });
    const { dealSync } = await createTourForWonDeal(
      tx,
      { ...deal, status: 'won' },
      { targetTourEventId: tourEventId, origin: runOrigin, allowOverbook: effectiveOverbook },
    );
    if (dealSync) await tx.deal.update({ where: { id: dealId }, data: dealSync });

    // Normalize the deal's now-counting registration to CONFIRMED and stamp the
    // money state (a fresh WON booking writes legacy 'active'; an adopted hold is
    // already 'confirmed' — both converge here).
    if (tourEventId) {
      await tx.ticketRegistration.updateMany({
        where: { dealId, tourEventId, status: { in: ['active', 'confirmed'] } },
        data: { status: 'confirmed', confirmedAt: new Date(), paymentStatus, ...(noPaymentReason ? { noPaymentReason } : {}) },
      });
    }

    if (lateExpired) {
      await emitTimelineEvent(tx, {
        subjectType: 'deal',
        subjectId: dealId,
        kind: 'tour',
        body: '💳 תשלום התקבל לאחר פקיעת השריון — הדיל נסגר והמקום שוחזר',
        data: { event: 'late_payment_won', tourEventId, overbook: effectiveOverbook },
        origin: runOrigin,
      });
    }
    if (noPaymentReason) {
      await emitTimelineEvent(tx, {
        subjectType: 'deal',
        subjectId: dealId,
        kind: 'tour',
        body: `📝 נרשם ללא תשלום — ${noPaymentReason}`,
        data: { event: 'no_payment_won', tourEventId, reason: noPaymentReason },
        origin: runOrigin,
      });
    }
    return { dealId, wonNow: true, tourEventId, lateExpired, overbook: effectiveOverbook };
  });
}

// Verified payment → WON. Every payment provider calls THIS.
export async function settleDealWonFromPayment(client, opts = {}) {
  return settleDealWon(client, { ...opts, paymentStatus: 'paid' });
}

// Register without payment → WON. The reason is stored canonically on the
// registration (noPaymentReason). The commercial total is NOT erased.
export async function settleDealWonNoPayment(client, { dealId, targetTourEventId, reason, allowOverbook = false, origin } = {}) {
  return settleDealWon(client, {
    dealId,
    targetTourEventId,
    allowOverbook,
    origin,
    paymentStatus: 'waived',
    noPaymentReason: reason,
  });
}
