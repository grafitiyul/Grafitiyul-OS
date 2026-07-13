import { createHeldRegistration } from '../tours/registrationLifecycle.js';
import { REG_HELD, REG_EXPIRED } from '../tours/registrationStatus.js';
import { recomputeTourOperationalProduct } from '../tours/operationalProduct.js';
import { markTourWooPending } from '../tours/woo/service.js';
import { settleDealWonNoPayment } from './paymentWon.js';
import { emitTimelineEvent, systemOrigin } from '../timeline/events.js';
import { durationToMs, durationLabelHe } from '../../../shared/reservationDuration.mjs';

// Registration-completion actions the progressive modal calls. All build on the
// shipped lifecycle primitives (createHeldRegistration / settleDealWon*) — no new
// reservation entity, no duplicated WON logic. Every action is idempotent.

// IDEMPOTENT hold: reuse the deal's existing HELD/EXPIRED reservation for this
// tour (re-hold / extend), else create one. Never a duplicate hold on repeated
// save/send. Returns the registration. The Deal stays OPEN.
export async function holdRegistrationForDeal(client, opts = {}) {
  const { dealId, tourEventId, productVariantId = null, priceRuleId = null, cardGroupId = null, quantity, value, unit, source = 'deal', origin } = opts;
  const ms = durationToMs(value, unit);
  const expiresAt = ms ? new Date(Date.now() + ms) : null;
  return client.$transaction(async (tx) => {
    const existing = await tx.ticketRegistration.findFirst({
      where: { dealId, tourEventId, status: { in: [REG_HELD, REG_EXPIRED] } },
      orderBy: { createdAt: 'desc' },
    });
    let reg;
    let created = false;
    if (existing) {
      reg = await tx.ticketRegistration.update({
        where: { id: existing.id },
        data: {
          status: REG_HELD,
          quantity: Number(quantity) || existing.quantity,
          productVariantId: productVariantId ?? existing.productVariantId,
          priceRuleId: priceRuleId ?? existing.priceRuleId,
          cardGroupId: cardGroupId ?? existing.cardGroupId,
          expiresAt,
          heldAt: new Date(),
          expiredAt: null,
          paymentStatus: 'pending',
        },
      });
      await recomputeTourOperationalProduct(tx, tourEventId);
      await markTourWooPending(tx, tourEventId);
    } else {
      reg = await createHeldRegistration(tx, { tourEventId, dealId, productVariantId, priceRuleId, cardGroupId, quantity, source, expiresAt });
      created = true;
    }
    await emitTimelineEvent(tx, {
      subjectType: 'deal',
      subjectId: dealId,
      kind: 'tour',
      body: `⏳ המקום שוריין${expiresAt ? ` עד ${expiresAt.toISOString()}` : ''}`,
      data: { event: created ? 'hold_created' : 'hold_updated', tourEventId, registrationId: reg.id, expiresAt, quantity: Number(quantity) || existing?.quantity },
      origin: origin || systemOrigin(),
    });
    return { registration: reg, expiresAt, durationLabel: (value && unit) ? durationLabelHe(value, unit) : null };
  });
}

// Send-payment-link: create/extend the hold, then record the EXACT message the
// operator is sending in the Deal timeline (audit). The actual WhatsApp delivery
// reuses the existing WhatsApp pipeline (client). Deal stays OPEN; the expiry
// worker handles expiration. Idempotent (re-send extends the same hold).
export async function recordPaymentLinkSent(client, { dealId, tourEventId, registrationId, message, phone, paymentLink, origin }) {
  await emitTimelineEvent(client, {
    subjectType: 'deal',
    subjectId: dealId,
    kind: 'tour',
    body: '📲 נשלח קישור לתשלום (וואטסאפ)',
    data: { event: 'payment_link_sent', tourEventId, registrationId, message, phone: phone || null, paymentLink: paymentLink || null },
    origin: origin || systemOrigin(),
  });
}

// Register WITHOUT payment: reason required, stored canonically, Deal → WON via
// the ONE canonical path (settleDealWonNoPayment). The commercial total is not
// erased. Idempotent (WON once).
export async function registerWithoutPayment(client, { dealId, tourEventId, reason, allowOverbook = false, origin }) {
  const trimmed = String(reason || '').trim();
  if (!trimmed) {
    const e = new Error('no_payment_reason_required');
    e.code = 'no_payment_reason_required';
    throw e;
  }
  return settleDealWonNoPayment(client, { dealId, targetTourEventId: tourEventId, reason: trimmed, allowOverbook, origin });
}
