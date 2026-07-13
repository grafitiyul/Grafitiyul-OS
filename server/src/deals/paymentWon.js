import { createTourForWonDeal } from '../tours/tourFromDeal.js';
import { findHeldRegistrationForDeal } from '../tours/registrationLifecycle.js';
import { REG_EXPIRED } from '../tours/registrationStatus.js';
import { emitTimelineEvent, systemOrigin } from '../timeline/events.js';

// THE one canonical service every verified payment funnels through — no WON logic
// duplicated in Cardcom / iCount / WooCommerce handlers. Business rule: a
// successful verified payment turns the Deal WON exactly once.
//
// Idempotent: a deal already WON is a no-op. It runs the EXISTING downstream WON
// pipeline (createTourForWonDeal) once, which — via syncDealRegistration's
// adoption — CONFIRMS the deal's existing HELD/EXPIRED reservation in place
// (the SAME row, never a duplicate). Late payment (the hold already expired) is
// accepted and allowed to overbook rather than rejected.
export async function settleDealWonFromPayment(client, { dealId, allowOverbook = false, origin } = {}) {
  const runOrigin = origin || systemOrigin();
  return client.$transaction(async (tx) => {
    const deal = await tx.deal.findUnique({ where: { id: dealId } });
    if (!deal) {
      const e = new Error('deal_not_found');
      e.code = 'deal_not_found';
      throw e;
    }
    // Idempotent: never WON twice, never a second registration.
    if (deal.status === 'won') return { dealId, alreadyWon: true };

    // The tour to WON onto is the deal's held (or lately-expired) reservation's
    // TourEvent — set when the reservation was created (pay-now / send-link).
    const held =
      (await findHeldRegistrationForDeal(tx, dealId)) ||
      (await tx.ticketRegistration.findFirst({ where: { dealId, status: REG_EXPIRED }, orderBy: { createdAt: 'desc' } }));
    const targetTourEventId = held?.tourEventId || null;
    const lateExpired = held?.status === REG_EXPIRED;
    // Late payment must NOT be rejected on capacity — allow overbook per policy.
    const effectiveOverbook = allowOverbook || lateExpired;

    await tx.deal.update({ where: { id: dealId }, data: { status: 'won' } });
    const { dealSync } = await createTourForWonDeal(
      tx,
      { ...deal, status: 'won' },
      { targetTourEventId, origin: runOrigin, allowOverbook: effectiveOverbook },
    );
    if (dealSync) await tx.deal.update({ where: { id: dealId }, data: dealSync });

    if (lateExpired) {
      await emitTimelineEvent(tx, {
        subjectType: 'deal',
        subjectId: dealId,
        kind: 'tour',
        body: '💳 תשלום התקבל לאחר פקיעת השריון — הדיל נסגר והמקום שוחזר',
        data: { event: 'late_payment_won', tourEventId: targetTourEventId, overbook: effectiveOverbook },
        origin: runOrigin,
      });
    }
    // Capacity-exceeded (late overbook or otherwise) is surfaced by the
    // over_capacity Operations Control detector (re-derived from live occupancy).
    return { dealId, wonNow: true, tourEventId: targetTourEventId, lateExpired, overbook: effectiveOverbook };
  });
}
