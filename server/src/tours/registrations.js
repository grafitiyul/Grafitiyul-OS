// Canonical ticket registration service — the ONE place deal bookings are
// mirrored into the source-agnostic TicketRegistration SSOT, and the ONE place
// tour occupancy (seats) is derived. WooCommerce and future channels write their
// own rows here directly; the Booking is only CRM linkage, never the seat truth.
//
// Single-product deal model (today): one deal booking → exactly one 'deal'
// registration carrying the tour's operational variant. When a booking later
// splits into several ticket products, this becomes several rows per booking —
// occupancy and derivation already sum over rows, so nothing downstream changes.

import { recomputeTourOperationalProduct } from './operationalProduct.js';
import { markTourWooPending } from './woo/service.js';
import { REG_HELD, REG_EXPIRED, REG_CONFIRMED, REG_ACTIVE, CAPACITY_STATUSES } from './registrationStatus.js';

// A booking's allocation state maps onto its registration: only 'active' seats
// count. 'orphaned' (deal left WON but tour kept) is intentionally NOT counted,
// so it collapses to a non-active registration like 'cancelled'.
export function regStatusFromBooking(bookingStatus) {
  return bookingStatus === 'active' ? 'active' : 'cancelled';
}


// Idempotently converge the single 'deal' registration for a booking onto the
// booking's current state (seats, status) and its SELLABLE product variant.
// Runs inside the caller's transaction, called after every booking mutation.
// For open tours (group slots) it then re-derives the operational product from
// the tour's active registrations — the ONE hook every registration source
// (deal now, WooCommerce/future later) funnels through.
//
// The product variant is the DEAL's chosen sellable variant (the ticket the
// customer bought — e.g. workshop vs plain), NOT the slot's base variant, so the
// operational-product derivation sees the real capability. Callers with the deal
// pass it via opts.productVariantId; callers without one (cancel/orphan) omit it
// and the existing registration's variant is preserved.
//
// Stable identity for auditability + idempotent upsert: source='deal',
// externalOrderId=dealId (the source order), externalLineId=bookingId (the stable
// per-tour line). Lookup stays keyed on bookingId so pre-existing (backfilled)
// rows are matched and never duplicated.
export async function syncDealRegistration(tx, booking, tour, opts = {}) {
  const quantity = Number(booking.seats) || 0;
  // The BOOKING is the seat line — every registration hanging off it belongs to
  // it, whatever created the row. Looking this up with `source: 'deal'` (as it
  // did) made the legacy-import twins invisible to GOS: a booking that already
  // carried a `migration` registration got a SECOND live row on first edit
  // (double seats + the customer twice on every roster), and cancelling the
  // booking only ever converged the 'deal' row — so the `migration` twin stayed
  // live forever. That is how a cancelled participant kept its seat and kept
  // showing up in the Guide Portal. The whole booking converges here now.
  const siblings = await tx.ticketRegistration.findMany({
    where: { bookingId: booking.id },
    orderBy: { createdAt: 'asc' },
  });
  // The canonical row: the deal-sourced one when it exists, otherwise a LONE
  // foreign-source row is adopted in place (its `source` is preserved — the
  // audit trail must stay honest about where the seat came from). A booking
  // carrying SEVERAL foreign rows and no deal row is the legacy per-participant
  // shape; it gets a canonical row like any other and its old rows are released
  // below, so the booking ends with exactly one live seat line either way.
  let existing =
    siblings.find((r) => r.source === 'deal') ||
    (siblings.length === 1 ? siblings[0] : null);
  // ADOPTION (payment→WON): a deal's HELD/EXPIRED reservation (created before
  // WON, so not yet booking-linked) is CONFIRMED in place — the SAME row, never a
  // duplicate. Also covers late payment: an EXPIRED reservation is re-confirmed.
  let adopting = false;
  if (!existing && booking.status === 'active') {
    existing = await tx.ticketRegistration.findFirst({
      where: { dealId: booking.dealId, tourEventId: tour.id, status: { in: [REG_HELD, REG_EXPIRED] } },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) adopting = true;
  }
  // CONFIRMED is a STRONGER state than the legacy 'active', never a parallel
  // one — it means a verified payment was stamped on this seat. This sync runs
  // after EVERY booking mutation (seat change, "עדכון סיור", reconnect), and it
  // used to recompute the status purely from the booking, quietly rewriting a
  // paid 'confirmed' row back to 'active' on the next unrelated tour edit. The
  // seat still counted (both are capacity + confirmed statuses), so nothing
  // visibly broke — the settlement record just decayed. A live booking may only
  // ever move a registration UP to confirmed, never back down.
  const fromBooking = regStatusFromBooking(booking.status);
  const status =
    adopting || (fromBooking === REG_ACTIVE && existing?.status === REG_CONFIRMED)
      ? REG_CONFIRMED
      : fromBooking;
  // Explicit selection wins; else keep the existing row's variant; else fall
  // back to the tour's (last resort, e.g. a legacy row with no deal context).
  const productVariantId =
    opts.productVariantId !== undefined
      ? opts.productVariantId
      : existing
        ? existing.productVariantId
        : (tour?.productVariantId ?? null);
  // The canonical purchased composition — set only when the caller resolved it.
  const breakdownPatch = opts.ticketBreakdown !== undefined ? { ticketBreakdown: opts.ticketBreakdown } : {};
  let regId;
  if (existing) {
    await tx.ticketRegistration.update({
      where: { id: existing.id },
      data: {
        quantity,
        productVariantId,
        status,
        bookingId: booking.id,
        externalOrderId: booking.dealId,
        externalLineId: booking.id,
        ...breakdownPatch,
        // Adoption confirms + clears the hold; preserve the row's audit history.
        ...(adopting ? { confirmedAt: new Date(), expiresAt: null, paymentStatus: 'paid' } : {}),
        cancelledAt: status === 'cancelled' ? existing.cancelledAt || new Date() : null,
      },
    });
    regId = existing.id;
  } else {
    const created = await tx.ticketRegistration.create({
      data: {
        tourEventId: tour.id,
        productVariantId,
        quantity,
        source: 'deal',
        bookingId: booking.id,
        dealId: booking.dealId,
        externalOrderId: booking.dealId,
        externalLineId: booking.id,
        status,
        ...breakdownPatch,
        cancelledAt: status === 'cancelled' ? new Date() : null,
      },
    });
    regId = created.id;
  }
  // RELEASE the rest of the booking's seat lines. A booking holds exactly ONE
  // live registration; anything else on it is a stale twin (a legacy-import row
  // GOS could not see, an old per-participant row) and must stop consuming
  // capacity and stop rendering as a participant. Idempotent — a second run
  // matches nothing. Rows are cancelled, never deleted: the history stays.
  const stale = siblings.filter((r) => r.id !== regId && CAPACITY_STATUSES.includes(r.status));
  if (stale.length) {
    await tx.ticketRegistration.updateMany({
      where: { id: { in: stale.map((r) => r.id) } },
      data: { status: 'cancelled', cancelledAt: new Date() },
    });
  }
  // Only open tours derive their product from registrations; deal tours keep
  // their deal-driven product. Cheap kind gate avoids an extra query otherwise.
  // A registration change also moves the shared stock → mark the Woo mirror
  // dirty so the variation's remaining capacity re-syncs.
  if (tour?.kind === 'group_slot') {
    await recomputeTourOperationalProduct(tx, tour.id);
    await markTourWooPending(tx, tour.id);
  }
  return regId;
}

// Stamp the SETTLED money state onto the deal's seat line — THE one place a
// verified payment becomes visible on the registration.
//
// Why this is a shared function and not an inline block: the immediate
// settlement (settleDealWon) and the delayed recovery (complete-tour-setup)
// must produce IDENTICAL records. Before it existed the stamp lived inside
// settleDealWon's "the tour was created" branch, so a deal whose tour could not
// be created at payment time — exactly the case the recovery flow exists for —
// got its tour minutes later with the registration still reading 'active' and
// paymentStatus null, as if nobody had paid (production #27105, #27074, #27060).
//
// `paymentStatus` must come from PROVEN evidence (settledPaymentStateFor reads
// the frozen Deal.wonActor), never from an assumption: a manually closed deal
// stamps nothing.
//
// Idempotent by construction: rows already carrying this exact settled state are
// excluded, so a retry or a second recovery click cannot rewrite confirmedAt.
// Returns the number of rows actually stamped.
export async function stampSettledRegistration(
  tx,
  { dealId, tourEventId, paymentStatus, noPaymentReason = null },
) {
  if (!dealId || !tourEventId || !paymentStatus) return 0;
  const res = await tx.ticketRegistration.updateMany({
    where: {
      dealId,
      tourEventId,
      status: { in: [REG_ACTIVE, REG_CONFIRMED] },
      NOT: { status: REG_CONFIRMED, paymentStatus, confirmedAt: { not: null } },
    },
    data: {
      status: REG_CONFIRMED,
      confirmedAt: new Date(),
      paymentStatus,
      ...(noPaymentReason ? { noPaymentReason } : {}),
    },
  });
  return res.count;
}
