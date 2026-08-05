// WON operational-recovery state — the canonical "commercially closed but
// operationally incomplete" resolver behind the Deal page's recovery banner.
//
// WON is the moment a commercial Deal must become a real operational tour.
// When that chain did not finish (payment-driven WON before planning was
// complete — production #27074), the deal HONESTLY stays WON and this resolver
// names the ONE next action, computed on read from live state (the
// tourUpdatePending convention: nothing stored, nothing to go stale):
//
//   'plan_tour'             — no active booking: complete the missing planning
//                             fields and create the tour (group deals: pick a
//                             slot). Data = wonGate's missing checklist.
//   'confirmation_pending'  — tour exists but the confirmation email has not
//                             gone out (an open confirmation review card is the
//                             explicit blocking reason). The banner morphs to
//                             the remaining action instead of disappearing and
//                             letting the deal look complete.
//   null                    — chain complete (or not applicable): no banner.
//
// Orphaned bookings keep their own dedicated UI/flow (reconnect) — this
// resolver deliberately steps aside so two banners never fight over one deal.

import { wonGate } from '../tours/tourFromDeal.js';
import { CONFIRMATION_EMAIL_REVIEW_KIND } from '../reviewItems/kinds/confirmationEmailReview.js';
import { autoSendFailureReasonHe } from '../confirmation/failureReason.js';
import { israelToday } from '../lib/israelDate.js';

// LIVE obligation — the ONE scoping rule shared by the banner and the בקרה
// detector (won-deal-without-tour): a missing tour is actionable when its date
// is still ahead, or when the deal has no date yet but was won recently.
// Hundreds of legacy-migrated WON deals (2021-2026, no date, no booking) are
// history, not emergencies — verified against production before choosing this
// gate: without it the sweep floods with ~380 legacy rows; with it, only the
// real incidents remain.
export const RECENT_WON_DAYS = 30;

/** Prisma where-fragment version (detector sweep). */
export function liveWonObligationWhere(nowMs = Date.now()) {
  return {
    status: 'won',
    bookings: { none: { status: 'active' } },
    OR: [
      { tourDate: { gte: israelToday(nowMs) } },
      { tourDate: null, wonAt: { gte: new Date(nowMs - RECENT_WON_DAYS * 24 * 60 * 60 * 1000) } },
    ],
  };
}

/** JS version of the same rule (deal-DTO banner resolver). */
export function isLiveWonObligation(deal, nowMs = Date.now()) {
  if (deal.tourDate) return String(deal.tourDate) >= israelToday(nowMs);
  const wonAt = deal.wonAt ? new Date(deal.wonAt).getTime() : null;
  return wonAt != null && wonAt >= nowMs - RECENT_WON_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * @param client prisma (or tx)
 * @param deal   a loaded deal row WITH `bookings` included (DEAL_INCLUDE shape)
 * @returns the recovery-state object or null
 */
export async function wonRecoveryState(client, deal) {
  if (!deal || deal.status !== 'won') return null;
  const bookings = deal.bookings || [];
  if (bookings.some((bk) => bk.status === 'orphaned')) return null;
  const active = bookings.find((bk) => bk.status === 'active') || null;

  if (!active) {
    if (!isLiveWonObligation(deal)) return null;
    const gate = wonGate(deal, null);
    return {
      state: 'plan_tour',
      missing: gate.missing, // [{ field, labelHe }] — rendered verbatim
      needsSlot: gate.needsSlot,
    };
  }

  // Tour exists — the chain is complete only once the confirmation email went
  // out (or an operator handled the card). The open card IS the explicit
  // remaining blocker, so it drives the banner.
  const openCard = await client.reviewItem.findFirst({
    where: { kind: CONFIRMATION_EMAIL_REVIEW_KIND, dealId: deal.id, status: 'open' },
    select: { data: true },
    orderBy: { createdAt: 'desc' },
  });
  if (openCard) {
    const d = openCard.data || {};
    return {
      state: 'confirmation_pending',
      reasonHe: d.autoSendError
        ? autoSendFailureReasonHe(d.autoSendError, d.autoSendWarnings)
        : null,
    };
  }
  return null;
}
