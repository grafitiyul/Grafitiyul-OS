import { createHeldRegistration } from '../tours/registrationLifecycle.js';
import { REG_HELD, REG_EXPIRED } from '../tours/registrationStatus.js';
import { recomputeTourOperationalProduct } from '../tours/operationalProduct.js';
import { markTourWooPending } from '../tours/woo/service.js';
import { settleDealWonNoPayment } from './paymentWon.js';
import { resolveDealGroupOffering } from './groupOffering.js';
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
    // The held seat's operational capability + composition come from the deal's
    // Group Ticket Builder card selection (the canonical offering), never a tour
    // snapshot. Explicit opts.productVariantId still wins if the caller forces it.
    const offering = await resolveDealGroupOffering(tx, dealId);
    const wantVariant = productVariantId ?? offering?.productVariantId ?? null;
    const breakdown = offering ? offering.ticketBreakdown : undefined;
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
          productVariantId: wantVariant ?? existing.productVariantId,
          priceRuleId: priceRuleId ?? existing.priceRuleId,
          cardGroupId: cardGroupId ?? existing.cardGroupId,
          ...(breakdown !== undefined ? { ticketBreakdown: breakdown } : {}),
          expiresAt,
          heldAt: new Date(),
          expiredAt: null,
          paymentStatus: 'pending',
        },
      });
      await recomputeTourOperationalProduct(tx, tourEventId);
      await markTourWooPending(tx, tourEventId);
    } else {
      reg = await createHeldRegistration(tx, { tourEventId, dealId, productVariantId: wantVariant, priceRuleId, cardGroupId, quantity, source, expiresAt, ticketBreakdown: breakdown });
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

// Record the EXACT payment-link message + URL in the Deal timeline (audit),
// stamped with the real delivery OUTCOME. `sent:true` only when the WhatsApp
// bridge acknowledged the send — a failed send is recorded honestly as a failure
// (never as "sent"). Deal stays OPEN either way; the expiry worker handles the
// hold. Called after the hold is created and the send attempt returns.
export async function recordPaymentLinkOutcome(
  client,
  { dealId, tourEventId, registrationId, message, phone, paymentLink, sent, externalMessageId = null, failureReason = null, origin },
) {
  await emitTimelineEvent(client, {
    subjectType: 'deal',
    subjectId: dealId,
    kind: 'tour',
    body: sent
      ? '📲 נשלח קישור לתשלום (וואטסאפ)'
      : `⚠️ שליחת קישור התשלום נכשלה${failureReason ? ` (${failureReason})` : ''} — הקישור מוכן לשליחה חוזרת`,
    data: {
      event: sent ? 'payment_link_sent' : 'payment_link_send_failed',
      tourEventId,
      registrationId,
      message,
      phone: phone || null,
      paymentLink: paymentLink || null,
      externalMessageId,
      failureReason,
    },
    origin: origin || systemOrigin(),
  });
}

// Cancel the deal's active HELD reservation (releases the seat). Idempotent.
export async function cancelHold(client, { dealId, origin }) {
  return client.$transaction(async (tx) => {
    const held = await tx.ticketRegistration.findFirst({ where: { dealId, status: REG_HELD }, orderBy: { createdAt: 'desc' } });
    if (!held) return { cancelled: false };
    await tx.ticketRegistration.update({ where: { id: held.id }, data: { status: 'cancelled', cancelledAt: new Date() } });
    await recomputeTourOperationalProduct(tx, held.tourEventId);
    await markTourWooPending(tx, held.tourEventId);
    await emitTimelineEvent(tx, {
      subjectType: 'deal',
      subjectId: dealId,
      kind: 'tour',
      body: '🚫 השריון בוטל',
      data: { event: 'hold_cancelled', tourEventId: held.tourEventId, registrationId: held.id },
      origin: origin || systemOrigin(),
    });
    return { cancelled: true, tourEventId: held.tourEventId };
  });
}

// HTML-escape a reason before it becomes note body (the note is rich HTML).
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// A PINNED Deal note recording the no-payment reason, so it sits in the Deal
// FOCUS area (near the top) — the reason is never buried in the timeline. Uses
// the SAME timelineEntry + pin mechanism as accounting docs. Idempotent: repeat
// registrations UPDATE the single marked note (data.event='no_payment_note')
// instead of stacking duplicates.
async function pinNoPaymentNote(client, { dealId, reason, origin }) {
  const body = `<p><strong>רישום ללא תשלום:</strong> ${escapeHtml(reason)}</p>`;
  const existing = await client.timelineEntry.findFirst({
    where: { subjectType: 'deal', subjectId: dealId, kind: 'note', isPinned: true, deletedAt: null, data: { path: ['event'], equals: 'no_payment_note' } },
    select: { id: true },
  });
  if (existing) {
    return client.timelineEntry.update({
      where: { id: existing.id },
      data: { body, data: { event: 'no_payment_note', reason } },
    });
  }
  const last = await client.timelineEntry.findFirst({
    where: { subjectType: 'deal', subjectId: dealId, isPinned: true, deletedAt: null },
    orderBy: { pinSortOrder: 'desc' },
    select: { pinSortOrder: true },
  });
  const entry = await emitTimelineEvent(client, {
    subjectType: 'deal',
    subjectId: dealId,
    kind: 'note',
    body,
    data: { event: 'no_payment_note', reason },
    origin: origin || systemOrigin(),
  });
  return client.timelineEntry.update({
    where: { id: entry.id },
    data: { isPinned: true, pinSortOrder: (last?.pinSortOrder ?? -1) + 1 },
  });
}

// Register WITHOUT payment: reason required, stored canonically, Deal → WON via
// the ONE canonical path (settleDealWonNoPayment). The commercial total is not
// erased. A PINNED Deal note surfaces the reason near the top. Idempotent (WON
// once; the pinned note is updated, never duplicated).
export async function registerWithoutPayment(client, { dealId, tourEventId, reason, allowOverbook = false, origin }) {
  const trimmed = String(reason || '').trim();
  if (!trimmed) {
    const e = new Error('no_payment_reason_required');
    e.code = 'no_payment_reason_required';
    throw e;
  }
  const result = await settleDealWonNoPayment(client, { dealId, targetTourEventId: tourEventId, reason: trimmed, allowOverbook, origin });
  // Pin AFTER the WON settlement so it never leaves a note on a deal that failed
  // to settle (e.g. tour_full throws above and we never reach here).
  await pinNoPaymentNote(client, { dealId, reason: trimmed, origin });
  return result;
}
