import { createHeldRegistration } from '../tours/registrationLifecycle.js';
import { REG_HELD, REG_EXPIRED } from '../tours/registrationStatus.js';
import { recomputeTourOperationalProduct } from '../tours/operationalProduct.js';
import { markTourWooPending } from '../tours/woo/service.js';
import { settleDealWon, settleDealWonNoPayment } from './paymentWon.js';
import { recordEvidence } from '../collectionEvidenceService.js';
import { resolveDealGroupOffering } from './groupOffering.js';
import {
  loadGroupTicketLines,
  snapshotWaiverFromLines,
  applyWaiverDecision,
  computePayableMinor,
  describeWaiver,
  describeWaiverCancelled,
} from './waiver.js';
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

// A PINNED Deal note reflecting the CURRENT commercial reality of the waiver, so
// it sits in the Deal FOCUS area (never buried) and EVOLVES as the builder is
// edited (full waiver → partial → cancelled). Uses the SAME timelineEntry + pin
// mechanism as accounting docs. Idempotent: the single marked note
// (data.event='no_payment_note') is UPDATED, never duplicated. THE one place the
// waiver note is written — shared by registerWithoutPayment and the builder-save
// waiver reconciliation.
export async function upsertWaiverNote(client, { dealId, body, reason, origin }) {
  const existing = await client.timelineEntry.findFirst({
    where: { subjectType: 'deal', subjectId: dealId, kind: 'note', isPinned: true, deletedAt: null, data: { path: ['event'], equals: 'no_payment_note' } },
    select: { id: true },
  });
  if (existing) {
    return client.timelineEntry.update({
      where: { id: existing.id },
      data: { body, data: { event: 'no_payment_note', reason: reason ?? null } },
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
    data: { event: 'no_payment_note', reason: reason ?? null },
    origin: origin || systemOrigin(),
  });
  return client.timelineEntry.update({
    where: { id: entry.id },
    data: { isPinned: true, pinSortOrder: (last?.pinSortOrder ?? -1) + 1 },
  });
}

// Register WITHOUT payment: reason required, Deal → WON via the ONE canonical
// path (settleDealWonNoPayment). It records a canonical WAIVER (all current
// tickets waived) — the QuoteLines KEEP their real prices (the builder stays
// commercial); the payable total (Deal.valueMinor) becomes ₪0. A PINNED Deal note
// reflects the waiver. Idempotent (WON once; the waiver is re-snapshotted from
// current lines; the pinned note is updated, never duplicated).
export async function registerWithoutPayment(client, { dealId, tourEventId, reason, allowOverbook = false, origin }) {
  const trimmed = String(reason || '').trim();
  if (!trimmed) {
    const e = new Error('no_payment_reason_required');
    e.code = 'no_payment_reason_required';
    throw e;
  }
  // Canonical waiver from the CURRENT commercial lines (prices untouched). A full
  // waiver at registration → payable 0 (unambiguous business intent).
  const lines = await loadGroupTicketLines(client, dealId);
  const waiver = snapshotWaiverFromLines(lines, { reason: trimmed, at: new Date() });
  await client.deal.update({ where: { id: dealId }, data: { noPaymentWaiver: waiver, valueMinor: 0n } });
  const result = await settleDealWonNoPayment(client, { dealId, targetTourEventId: tourEventId, reason: trimmed, allowOverbook, origin });
  // Pin AFTER the WON settlement so it never leaves a note on a deal that failed
  // to settle (e.g. tour_full throws above and we never reach here).
  await upsertWaiverNote(client, { dealId, body: describeWaiver(waiver, lines), reason: trimmed, origin });
  return result;
}

// Register with a MANUAL payment — the customer paid OUTSIDE GOS (Bit, PayBox,
// external credit card, cash, bank transfer…). Two explicit business modes,
// NEITHER of which is "free" — the commercial total is NEVER zeroed and no
// waiver is recorded:
//
//   mode 'record'            — the operator knows the amount: a canonical
//     manual-payment evidence row (collectionEvidenceService.recordEvidence,
//     the SAME write path as the גבייה panel) + WON. Collection balance
//     reflects the recorded money; the document is issued separately through
//     the existing הפק מסמך modal (the UI chains it).
//
//   mode 'external_approved' — the operator attests the deal was paid/approved
//     outside the system WITHOUT payment details: NO payment row is fabricated.
//     The canonical 'settlement' evidence (an explicit audited "balance closed
//     by decision" record with the operator's name — collection's own concept,
//     never dressed as a payment or document) closes the balance, and a
//     dedicated timeline event says exactly why the deal is WON with no
//     recorded payment.
//
// Both transition through the ONE canonical WON path (settleDealWon →
// transitionDealToWon) exactly once. Duplicate clicks: the atomic WON guard
// decides — an alreadyWon result SKIPS the evidence write, so no second
// evidence row and no second WON.
export async function registerWithManualPayment(
  client,
  { dealId, tourEventId, mode, method = null, amountIls = null, paidAt = null, reference = null, note = null, allowOverbook = false, userId = null, origin },
) {
  if (mode !== 'record' && mode !== 'external_approved') {
    const e = new Error('invalid_manual_mode');
    e.code = 'invalid_manual_mode';
    throw e;
  }
  if (mode === 'record' && !(Number(amountIls) > 0)) {
    const e = new Error('amount_invalid');
    e.code = 'amount_invalid';
    throw e;
  }
  const deal = await client.deal.findUnique({
    where: { id: dealId },
    select: { id: true, currency: true, valueMinor: true, collectionReview: true },
  });
  if (!deal) {
    const e = new Error('deal_not_found');
    e.code = 'deal_not_found';
    throw e;
  }

  // 1) The ONE canonical WON transition + registration confirmation. The atomic
  //    guard makes this exactly-once; a duplicate click lands on alreadyWon and
  //    writes NOTHING further.
  const result = await settleDealWon(client, {
    dealId,
    targetTourEventId: tourEventId,
    allowOverbook,
    origin,
    paymentStatus: 'paid',
    paymentAmountMinor: mode === 'record' ? Math.round(Number(amountIls) * 100) : null,
    cause: mode === 'record' ? 'manual_payment' : 'external_payment',
  });
  if (result.alreadyWon) return result;

  // 2) The structured money record — canonical collection evidence.
  if (mode === 'record') {
    await recordEvidence(client, deal, {
      kind: 'manual_payment',
      amountIls: Number(amountIls),
      paidAt,
      method,
      reference,
      note,
    }, userId);
  } else {
    // 'settlement' computes the outstanding balance itself; on a deal that
    // somehow has none it throws nothing_outstanding — the WON stands and the
    // attestation event below still explains the state.
    await recordEvidence(client, deal, {
      kind: 'settlement',
      paidAt,
      method,
      note: String(note || '').trim() || 'שולם/אושר מחוץ למערכת — ללא פרטי תשלום',
    }, userId).catch((e) => {
      if (e?.code !== 'nothing_outstanding') throw e;
    });
    await emitTimelineEvent(client, {
      subjectType: 'deal',
      subjectId: dealId,
      kind: 'tour',
      body: '💳 הדיל אושר כשולם מחוץ למערכת — ללא פרטי תשלום ומבלי שהופק מסמך',
      data: { event: 'external_payment_won', tourEventId: tourEventId || null, method: method || null, note: String(note || '').trim() || null },
      origin: origin || systemOrigin(),
    });
  }
  return result;
}

// Reconcile a deal's waiver AFTER a builder save (the new lines are already
// persisted). THE one canonical waiver-recompute: applies the operator's decision
// (or a plain decrease / no-change), recomputes the payable total (valueMinor =
// gross − waived), evolves the pinned note, and records a timeline event. Used by
// the price-lines endpoint; `decision` is undefined for a decrease, or one of
// 'expand' | 'charge_added' | 'cancel'. Returns { newWaiver, payableMinor }.
export async function reconcileWaiverAfterSave(client, { dealId, waiver, grossMinor, decision, origin }) {
  const lines = await loadGroupTicketLines(client, dealId);
  const newWaiver = applyWaiverDecision(waiver, lines, decision);
  const payableMinor = computePayableMinor(grossMinor, newWaiver, lines);
  await client.deal.update({
    where: { id: dealId },
    data: { noPaymentWaiver: newWaiver, valueMinor: BigInt(Math.round(payableMinor)) },
  });
  const body = newWaiver ? describeWaiver(newWaiver, lines) : describeWaiverCancelled(waiver?.reason);
  await upsertWaiverNote(client, { dealId, body, reason: newWaiver?.reason ?? waiver?.reason ?? null, origin });
  await emitTimelineEvent(client, {
    subjectType: 'deal',
    subjectId: dealId,
    kind: 'tour',
    data: { event: 'waiver_updated', decision: decision || 'auto', payableMinor, cancelled: !newWaiver },
    origin: origin || systemOrigin(),
  });
  return { newWaiver, payableMinor };
}
