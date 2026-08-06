// ── "הפוך ל-WON שקט" — the historical WON correction ────────────────────────
//
// The real production case (deal #11931): a tour that happened years ago, that
// the customer paid for, whose Deal was never closed in the CRM. Pressing the
// normal WON button would be a lie in the other direction — it would fire
// TODAY's machinery at a years-old deal: a confirmation email to the customer,
// a "deal won" manager report, Communication-Center triggers, and a brand-new
// TourEvent for a tour that already happened.
//
// So this is a SEPARATE, deliberately narrow operation. What it does:
//   • flips the lifecycle status to WON through the ONE canonical transition
//     (deals/wonTransition.js) — no second writer of status='won' is created;
//   • stamps the operator's chosen business close date instead of "now";
//   • optionally creates the tour through the ONE canonical tour path;
//   • optionally sends the confirmation email — OFF unless explicitly asked;
//   • records an immutable audit note of exactly who chose what.
//
// What it deliberately does NOT do:
//   • fire deal_won / tour_datetime Communication triggers,
//   • fire the Manager Report #26 "deal won" alert,
//   • create, imply or infer ANY payment, accounting document or collection
//     state. A financial correction is a separate, explicit operator action.
//
// The tour-less case is recorded as an INTENTIONAL historical state
// (Deal.historicalWonAt) rather than by weakening the global safety detector:
// a genuinely broken WON-without-tour still raises in בקרה; this one does not.

import { transitionDealToWon } from './wonTransition.js';
import { createTourForWonDeal, wonGate } from '../tours/tourFromDeal.js';
import { runConfirmationOnWon, } from '../confirmation/wonHook.js';
import { wonTransitionKey } from './wonTransition.js';
import { ADMIN_NAME_SELECT } from '../admin/displayName.js';

export const HISTORICAL_WON_REASON = 'historical_correction';

/**
 * Normalise the operator's date choice into the instant we stamp.
 *
 * `mode: 'today'` → now. `mode: 'custom'` → the chosen calendar date at Israel
 * midday, which is the same calendar day in every timezone a reader might be
 * in — a historical close date must never drift a day because of a UTC
 * boundary. A future date is refused: a correction records what already
 * happened.
 */
export function resolveHistoricalWonAt({ mode, date }, nowMs = Date.now()) {
  if (mode !== 'custom') return { at: new Date(nowMs) };
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: 'invalid_won_date' };
  }
  const at = new Date(`${date}T12:00:00.000Z`);
  if (Number.isNaN(at.getTime())) return { error: 'invalid_won_date' };
  if (at.getTime() > nowMs) return { error: 'won_date_in_future' };
  return { at };
}

/**
 * What the operator is about to change — computed BEFORE the write so the
 * dialog can show exactly what will happen (and so the endpoint can refuse an
 * impossible tour request instead of half-applying it).
 */
export function silentWonPlan(deal, { createTour, tourEventId }) {
  const gate = wonGate(deal, tourEventId || null);
  return {
    alreadyWon: deal.status === 'won',
    previousStatus: deal.status,
    createTour: !!createTour,
    // Planning fields the canonical tour path requires; the dialog renders
    // these verbatim so "why can't I tick the box" is never a mystery.
    missingForTour: gate.missing,
    needsSlot: gate.needsSlot,
    canCreateTour: gate.missing.length === 0 && !gate.needsSlot,
  };
}

/**
 * Perform the correction inside the caller's transaction.
 *
 * Returns { wonNow, alreadyWon, deal, before, wonAt, tour } — `tour` is the
 * created/joined TourEvent or null. Idempotent by construction: the atomic
 * guard inside transitionDealToWon means a double-click / retry converges on
 * one transition, one audit note and one tour.
 */
export async function applySilentWon(
  tx,
  { deal, wonAt, createTour, tourEventId = null, emailRequested, actorUserId, origin },
) {
  const outcome = await transitionDealToWon(tx, {
    dealId: deal.id,
    actorUserId,
    cause: HISTORICAL_WON_REASON,
    wonAt,
  });
  if (!outcome.wonNow) {
    return { ...outcome, tour: null, wonAt: outcome.deal?.wonAt || null };
  }

  let tour = null;
  if (createTour) {
    const { tourEvent, dealSync } = await createTourForWonDeal(tx, { ...deal, status: 'won' }, {
      targetTourEventId: tourEventId,
      origin,
      allowOverbook: false,
    });
    tour = tourEvent;
    if (dealSync) await tx.deal.update({ where: { id: deal.id }, data: dealSync });
  }

  // The audit record — frozen NOW, with the actor resolved at correction time
  // so a later rename or deactivation cannot rewrite who did this.
  const actor = actorUserId
    ? await tx.adminUser.findUnique({ where: { id: actorUserId }, select: ADMIN_NAME_SELECT })
    : null;
  const note = {
    reason: HISTORICAL_WON_REASON,
    at: new Date().toISOString(),
    by: actor
      ? { userId: actor.id, displayName: actor.displayName ?? null, username: actor.username ?? null }
      : { userId: null, displayName: null, username: null },
    previousStatus: outcome.before.status,
    previousStageId: outcome.before.dealStageId || null,
    wonAt: new Date(outcome.wonAt).toISOString(),
    wonDateChoice: sameDay(outcome.wonAt, new Date()) ? 'today' : 'custom',
    emailRequested: !!emailRequested,
    tourCreated: !!tour,
    tourEventId: tour?.id || null,
    // Stated explicitly so the record cannot later be read as financial proof.
    financialEffect: 'none',
  };
  await tx.deal.update({
    where: { id: deal.id },
    // historicalWonAt is ALSO the detector exemption marker — but only when no
    // tour was created. A corrected deal that DID get its tour needs no
    // exemption (the booking resolves the issue on its own), and leaving the
    // marker off there keeps the exemption as narrow as the problem.
    data: {
      historicalWonAt: tour ? null : new Date(),
      historicalWonNote: note,
    },
  });

  return { ...outcome, tour, note };
}

function sameDay(a, b) {
  return new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10);
}

/**
 * Post-commit effects of a SILENT won — deliberately almost empty.
 *
 * The normal WON path (emitWonTransitionEffects) fires Communication-Center
 * triggers and the manager "deal won" report. A historical correction must
 * fire NEITHER: nobody should be messaged about a deal that closed years ago.
 * The confirmation email runs only when the operator explicitly ticked the box.
 */
export function emitSilentWonEffects({ dealId, wonAt, emailRequested, closedByUserId }, log = console) {
  if (!emailRequested) return;
  runConfirmationOnWon(
    {
      dealId,
      transitionKey: wonTransitionKey(dealId, wonAt),
      closedByUserId,
      suppressed: false,
    },
    { log },
  ).catch(() => {});
}
