import { createTourForWonDeal, wonGate } from '../tours/tourFromDeal.js';
import { findHeldRegistrationForDeal } from '../tours/registrationLifecycle.js';
import { REG_EXPIRED } from '../tours/registrationStatus.js';
import { emitTimelineEvent, systemOrigin } from '../timeline/events.js';
import { recordDealChanges } from '../timeline/dealChangelog.js';
import { publicOrigin } from '../communication/context.js';
import { reportOpenTourParticipant } from '../adminReports/openTourParticipantEvent.js';
import { transitionDealToWon, emitWonTransitionEffects } from './wonTransition.js';

/** Resolve the deal's registration on this tour and report the join (#13). */
async function notifyOpenTourJoin(client, dealId, tourEventId) {
  const reg = await client.ticketRegistration.findFirst({
    where: { dealId, tourEventId, status: { in: ['active', 'confirmed'] } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, quantity: true, customerName: true,
      deal: { select: { organization: { select: { name: true } }, contacts: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], take: 1, select: { contact: { select: { firstNameHe: true, lastNameHe: true } } } } } },
    },
  });
  if (!reg) return;
  const c = reg.deal?.contacts?.[0]?.contact;
  const name = reg.deal?.organization?.name
    || `${c?.firstNameHe || ''} ${c?.lastNameHe || ''}`.trim()
    || reg.customerName
    || null;
  await reportOpenTourParticipant(
    { tourEventId, registrationId: reg.id, customerName: name, count: reg.quantity },
    { client },
  );
}

// The canonical payment/registration-completion WON wrapper — every completion
// mode funnels through here: verified payment (pay-now / late payment / a
// credit-card payment on ANY deal) AND register-without-payment. The status
// transition itself (status + final stage + wonAt + wonQuoteRef + the atomic
// race guard) lives in deals/wonTransition.js — shared with the operator's
// manual WON — so no WON logic is duplicated in payment handlers.
//
// Idempotent: a deal already WON is a no-op ({ alreadyWon: true }), which is
// also how callers learn the deal's PRE-payment status (Report #1 vs #26).
//
// Tour side: runs the EXISTING WON pipeline (createTourForWonDeal) once, which
// — via syncDealRegistration's adoption — CONFIRMS the deal's existing HELD/
// EXPIRED reservation in place (same row, never a duplicate). Late payment
// (hold already expired) is accepted with overbook rather than rejected.
// A payment can also close a deal whose tour planning is incomplete (e.g. a
// Cardcom link on a deal with no scheduled date): WON is never blocked by
// that, but a broken/undated tour is never created either — the wonGate
// decides, and the skipped tour is flagged on the timeline for the office.
//
// `confirmation` stamps the money state on the confirmed registration:
// { paymentStatus, noPaymentReason }. `paymentAmountMinor` — the verified
// amount of the payment that caused this settlement (feeds Report #26's
// deposit line). `recordChangelog: false` lets a route that already snapshots
// its own before/after diff (register-without-payment) avoid a duplicate
// history entry.
export async function settleDealWon(
  client,
  {
    dealId,
    targetTourEventId = null,
    allowOverbook = false,
    origin,
    paymentStatus = 'paid',
    noPaymentReason = null,
    paymentAmountMinor = null,
    recordChangelog = true,
    cause = null,
  } = {},
) {
  const runOrigin = origin || systemOrigin();
  // ONE cause for the whole settlement: frozen into Deal.wonActor by the
  // transition AND carried into Report #26's payload — the two can never
  // disagree about why the deal closed.
  const effectiveCause = cause || (paymentStatus === 'waived' ? 'no_payment' : 'card_payment');
  const result = await client.$transaction(async (tx) => {
    // THE canonical transition: atomic status guard + final pipeline stage +
    // wonAt + wonQuoteRef + the frozen wonActor. An already-WON deal (or a
    // concurrent winner) exits here — retried IPNs and double callbacks are
    // no-ops.
    const t = await transitionDealToWon(tx, {
      dealId,
      publicOrigin: publicOrigin(),
      actorUserId: runOrigin?.createdBy || null,
      cause: effectiveCause,
    });
    if (!t.wonNow) return { dealId, alreadyWon: true };
    const deal = t.deal;

    // Target tour: explicit (no-payment picks it directly) else the deal's held/
    // lately-expired reservation's tour (pay-now / send-link created it).
    const held =
      (await findHeldRegistrationForDeal(tx, dealId)) ||
      (await tx.ticketRegistration.findFirst({ where: { dealId, status: REG_EXPIRED }, orderBy: { createdAt: 'desc' } }));
    const tourEventId = targetTourEventId || held?.tourEventId || null;
    const lateExpired = !targetTourEventId && held?.status === REG_EXPIRED;
    const effectiveOverbook = allowOverbook || lateExpired;

    const gate = wonGate(deal, tourEventId);
    const tourReady = gate.missing.length === 0 && !gate.needsSlot;

    let after = deal;
    if (tourReady) {
      const { dealSync } = await createTourForWonDeal(
        tx,
        deal,
        { targetTourEventId: tourEventId, origin: runOrigin, allowOverbook: effectiveOverbook },
      );
      if (dealSync) {
        await tx.deal.update({ where: { id: dealId }, data: dealSync });
        after = { ...deal, ...dealSync };
      }

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
    } else {
      // The deal is WON (the money is real) but its tour cannot be created yet —
      // an explicit, visible flag instead of a silent broken tour.
      await emitTimelineEvent(tx, {
        subjectType: 'deal',
        subjectId: dealId,
        kind: 'tour',
        body: '💳 הדיל נסגר מתשלום, אך פרטי הסיור אינם מלאים — נדרשת השלמת תכנון ידנית',
        data: {
          event: 'won_without_tour',
          missing: gate.missing.map((m) => m.field),
          needsSlot: gate.needsSlot,
        },
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
    return {
      dealId,
      wonNow: true,
      tourEventId: tourReady ? tourEventId : null,
      tourCreated: tourReady,
      lateExpired,
      overbook: effectiveOverbook,
      wonAt: t.wonAt,
      before: t.before,
      after,
    };
  });
  if (result?.wonNow) {
    // Status/stage history — before this convergence, an IPN-won deal left no
    // changelog row at all. Post-commit and non-fatal by recordDealChanges'
    // own contract.
    if (recordChangelog) {
      await recordDealChanges(client, {
        dealId,
        before: result.before,
        after: result.after,
        origin: runOrigin,
      });
    }
    // Communication Center triggers + Manager Report #26 — post-commit (callers
    // pass the root prisma client), fire-and-forget, exactly once: only the
    // transaction that flipped the status reaches this branch.
    emitWonTransitionEffects({
      dealId,
      wonAt: result.wonAt,
      cause: effectiveCause,
      closedByUserId: runOrigin?.createdBy || null,
      paymentAmountMinor,
    });
    // Admin Report #13 — a new participant on an OPEN tour. The report itself
    // checks that the tour really is an open tour, so every WON path can call
    // it unconditionally.
    if (result.tourEventId) notifyOpenTourJoin(client, dealId, result.tourEventId).catch(() => {});
  }
  return result;
}

// Verified payment → WON. Every payment provider calls THIS.
export async function settleDealWonFromPayment(client, opts = {}) {
  return settleDealWon(client, { ...opts, paymentStatus: 'paid' });
}

// Register without payment → WON. The reason is stored canonically on the
// registration (noPaymentReason). The commercial total is NOT erased.
// recordChangelog:false — the no-payment route snapshots its own before/after
// (it also zeroes the payable total) and records ONE grouped history entry.
export async function settleDealWonNoPayment(client, { dealId, targetTourEventId, reason, allowOverbook = false, origin } = {}) {
  return settleDealWon(client, {
    dealId,
    targetTourEventId,
    allowOverbook,
    origin,
    paymentStatus: 'waived',
    noPaymentReason: reason,
    recordChangelog: false,
  });
}
