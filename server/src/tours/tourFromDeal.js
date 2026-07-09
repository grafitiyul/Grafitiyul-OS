import { WON_REQUIRED_FIELDS, missingFields } from './requiredFields.js';
import { emitTimelineEvent } from '../timeline/events.js';

// Deal⇄Tour lifecycle — the ONE module that creates/joins/leaves tours for a
// deal. Called from the deals router inside a prisma transaction; never from
// anywhere else, so the product rules live in exactly one place:
//   * private/business: first WON auto-creates the deal's own TourEvent.
//     NO drafts — WON is refused (won_requirements_missing) while required
//     fields are missing.
//   * group: first WON JOINS an existing scheduled group slot; the slot is
//     authoritative — its product/variant/city/date/time/language are synced
//     ONTO the deal (changelog per field via the caller's recordDealChanges).
//   * the deal keeps at most ONE active booking (DB partial unique);
//     moving between tours is an explicit replace ("החלף סיור").
//   * empty private/business tours auto-cancel when their last active booking
//     leaves; group slots NEVER auto-cancel.

// Deal fields the WON gate + tour creation read. The deals router merges
// (existing ⊕ incoming patch) before calling the gate so "set field + WON in
// one save" works.
export const TOUR_GATE_SELECT = {
  id: true,
  activityType: true,
  productId: true,
  productVariantId: true,
  locationId: true,
  tourDate: true,
  tourTime: true,
  participants: true,
  tourLanguage: true,
};

// Deal planning fields that a joined GROUP slot owns (slot → deal sync; locked
// on the deal afterwards — changing them = replace tour).
export const GROUP_LOCKED_FIELDS = [
  'tourDate',
  'tourTime',
  'tourLanguage',
  'locationId',
  'productId',
  'productVariantId',
];

// Gate: what still blocks WON for this (merged) deal state? Returns
// { missing: [{field,labelHe}], needsSlot } — empty missing + false needsSlot
// means WON may proceed.
export function wonGate(mergedDeal, targetTourEventId) {
  const activityType = mergedDeal.activityType;
  const list = WON_REQUIRED_FIELDS[activityType];
  if (!list) {
    return { missing: [{ field: 'activityType', labelHe: 'סוג פעילות' }], needsSlot: false };
  }
  const missing = missingFields(mergedDeal, list);
  const needsSlot = activityType === 'group' && !targetTourEventId && missing.length === 0;
  return { missing, needsSlot };
}

// The deal's current ACTIVE booking (with its tour) — the single lookup every
// caller uses. Null when the deal is not on a tour.
export async function activeBookingFor(client, dealId) {
  return client.booking.findFirst({
    where: { dealId, status: 'active' },
    include: { tourEvent: true },
  });
}

// First-WON tour creation/join. Runs inside the caller's transaction.
// Returns { booking, tourEvent, dealSync } — dealSync is a patch of deal
// fields the caller MUST apply to the deal in the same transaction (group
// slot authority); null for private/business.
export async function createTourForWonDeal(tx, deal, { targetTourEventId, origin }) {
  // Idempotency: re-winning a deal that somehow still has an active booking
  // (e.g. two admin tabs) reuses it instead of violating the partial unique.
  const existing = await activeBookingFor(tx, deal.id);
  if (existing) return { booking: existing, tourEvent: existing.tourEvent, dealSync: null };

  const seats = Number(deal.participants);

  if (deal.activityType === 'group') {
    const slot = await tx.tourEvent.findUnique({ where: { id: targetTourEventId } });
    if (!slot || slot.kind !== 'group_slot') {
      const err = new Error('tour_slot_invalid');
      err.code = 'tour_slot_invalid';
      throw err;
    }
    if (slot.status !== 'scheduled') {
      const err = new Error('tour_slot_not_scheduled');
      err.code = 'tour_slot_not_scheduled';
      throw err;
    }
    const booking = await tx.booking.create({
      data: { tourEventId: slot.id, dealId: deal.id, seats, status: 'active' },
    });
    await emitTimelineEvent(tx, {
      subjectType: 'tour_event',
      subjectId: slot.id,
      kind: 'tour',
      data: { event: 'deal_joined', dealId: deal.id, dealOrderNo: deal.orderNo, seats },
      origin,
    });
    await emitTimelineEvent(tx, {
      subjectType: 'deal',
      subjectId: deal.id,
      kind: 'tour',
      data: {
        event: 'tour_joined',
        tourEventId: slot.id,
        kind: slot.kind,
        date: slot.date,
        startTime: slot.startTime,
        seats,
      },
      origin,
    });
    // The slot is authoritative: sync its planning fields onto the deal.
    return {
      booking,
      tourEvent: slot,
      dealSync: {
        tourDate: slot.date,
        tourTime: slot.startTime,
        tourLanguage: slot.tourLanguage,
        locationId: slot.locationId,
        productId: slot.productId,
        productVariantId: slot.productVariantId,
      },
    };
  }

  // private / business — the deal's own tour, seeded from its planning fields.
  const tourEvent = await tx.tourEvent.create({
    data: {
      kind: deal.activityType,
      status: 'scheduled',
      date: deal.tourDate,
      startTime: deal.tourTime,
      productId: deal.productId,
      productVariantId: deal.productVariantId,
      locationId: deal.locationId,
      tourLanguage: deal.tourLanguage,
    },
  });
  const booking = await tx.booking.create({
    data: { tourEventId: tourEvent.id, dealId: deal.id, seats, status: 'active' },
  });
  await emitTimelineEvent(tx, {
    subjectType: 'tour_event',
    subjectId: tourEvent.id,
    kind: 'tour',
    data: { event: 'tour_created', dealId: deal.id, dealOrderNo: deal.orderNo, seats },
    origin,
  });
  await emitTimelineEvent(tx, {
    subjectType: 'deal',
    subjectId: deal.id,
    kind: 'tour',
    data: {
      event: 'tour_created',
      tourEventId: tourEvent.id,
      kind: tourEvent.kind,
      date: tourEvent.date,
      startTime: tourEvent.startTime,
      seats,
    },
    origin,
  });
  return { booking, tourEvent, dealSync: null };
}

// Detach the deal from its tour (reopen-with-remove, LOST, or replace).
// Cancels the booking; a private/business tour whose LAST active booking just
// left is auto-cancelled (status, never delete). Group slots stay.
export async function cancelDealBooking(tx, booking, { reason, origin }) {
  await tx.booking.update({
    where: { id: booking.id },
    data: { status: 'cancelled', cancelledAt: new Date() },
  });
  await emitTimelineEvent(tx, {
    subjectType: 'tour_event',
    subjectId: booking.tourEventId,
    kind: 'tour',
    data: { event: 'deal_left', dealId: booking.dealId, reason },
    origin,
  });
  await emitTimelineEvent(tx, {
    subjectType: 'deal',
    subjectId: booking.dealId,
    kind: 'tour',
    data: {
      event: 'tour_left',
      tourEventId: booking.tourEventId,
      kind: booking.tourEvent.kind,
      date: booking.tourEvent.date,
      startTime: booking.tourEvent.startTime,
      reason,
    },
    origin,
  });

  const tour = booking.tourEvent;
  if (tour.kind !== 'group_slot' && tour.status === 'scheduled') {
    const remaining = await tx.booking.count({
      where: { tourEventId: tour.id, status: 'active' },
    });
    if (remaining === 0) {
      await tx.tourEvent.update({
        where: { id: tour.id },
        data: { status: 'cancelled', cancelledAt: new Date() },
      });
      await emitTimelineEvent(tx, {
        subjectType: 'tour_event',
        subjectId: tour.id,
        kind: 'tour',
        data: { event: 'auto_cancelled_empty', reason },
        origin,
      });
    }
  }
}

// Keep-the-tour path on reopen: the booking becomes an intentional ORPHAN —
// disconnected operational work, surfaced by the global header warning until
// reconnected or cancelled.
export async function orphanDealBooking(tx, booking, { origin }) {
  await tx.booking.update({
    where: { id: booking.id },
    data: { status: 'orphaned', orphanedAt: new Date() },
  });
  await emitTimelineEvent(tx, {
    subjectType: 'tour_event',
    subjectId: booking.tourEventId,
    kind: 'tour',
    data: { event: 'booking_orphaned', dealId: booking.dealId },
    origin,
  });
  await emitTimelineEvent(tx, {
    subjectType: 'deal',
    subjectId: booking.dealId,
    kind: 'tour',
    data: {
      event: 'booking_orphaned',
      tourEventId: booking.tourEventId,
      date: booking.tourEvent.date,
      startTime: booking.tourEvent.startTime,
    },
    origin,
  });
}

// Reconnect an ORPHANED booking to its original deal. Valid only when that
// deal is WON again and not already on another tour (attaching a DIFFERENT
// deal to a group slot is the regular "שבץ לסיור" flow — not this).
// Returns { dealSync } — non-null when the tour is a group slot (slot stays
// authoritative, its fields re-sync onto the deal).
export async function reconnectOrphanBooking(tx, booking, { origin }) {
  const deal = await tx.deal.findUnique({ where: { id: booking.dealId } });
  if (!deal || deal.status !== 'won') {
    const err = new Error('deal_not_won');
    err.code = 'deal_not_won';
    throw err;
  }
  const current = await activeBookingFor(tx, deal.id);
  if (current) {
    const err = new Error('deal_already_on_tour');
    err.code = 'deal_already_on_tour';
    throw err;
  }
  await tx.booking.update({
    where: { id: booking.id },
    data: { status: 'active', orphanedAt: null },
  });
  await emitTimelineEvent(tx, {
    subjectType: 'tour_event',
    subjectId: booking.tourEventId,
    kind: 'tour',
    data: { event: 'booking_reconnected', dealId: deal.id, dealOrderNo: deal.orderNo },
    origin,
  });
  await emitTimelineEvent(tx, {
    subjectType: 'deal',
    subjectId: deal.id,
    kind: 'tour',
    data: {
      event: 'booking_reconnected',
      tourEventId: booking.tourEventId,
      date: booking.tourEvent.date,
      startTime: booking.tourEvent.startTime,
    },
    origin,
  });

  const tour = booking.tourEvent;
  if (tour.kind === 'group_slot') {
    return {
      dealSync: {
        tourDate: tour.date,
        tourTime: tour.startTime,
        tourLanguage: tour.tourLanguage,
        locationId: tour.locationId,
        productId: tour.productId,
        productVariantId: tour.productVariantId,
      },
    };
  }
  // private/business: the deal stayed the planning source — mirror deal→tour.
  await syncDealToTour(tx, deal, { ...booking, status: 'active' }, { origin });
  return { dealSync: null };
}

// Mechanical Deal→Tour mirror for private/business tours. The DEAL is the
// planning source of truth after WON; this runs in the SAME transaction as
// every deal save so the two can never drift. Returns true when the tour row
// actually changed.
export async function syncDealToTour(tx, deal, booking, { origin }) {
  const tour = booking.tourEvent;

  // seats always mirror participants (both tour kinds).
  const seats = Number(deal.participants);
  if (Number.isInteger(seats) && seats >= 1 && seats !== booking.seats) {
    await tx.booking.update({ where: { id: booking.id }, data: { seats } });
  }

  if (tour.kind === 'group_slot') return false; // slot planning is slot-owned

  const patch = {};
  if (deal.tourDate && deal.tourDate !== tour.date) patch.date = deal.tourDate;
  if (deal.tourTime && deal.tourTime !== tour.startTime) patch.startTime = deal.tourTime;
  if ((deal.tourLanguage || null) !== tour.tourLanguage) patch.tourLanguage = deal.tourLanguage || null;
  if ((deal.productId || null) !== tour.productId) patch.productId = deal.productId || null;
  if ((deal.productVariantId || null) !== tour.productVariantId)
    patch.productVariantId = deal.productVariantId || null;
  if ((deal.locationId || null) !== tour.locationId) patch.locationId = deal.locationId || null;

  if (!Object.keys(patch).length) return false;
  await tx.tourEvent.update({ where: { id: tour.id }, data: patch });
  await emitTimelineEvent(tx, {
    subjectType: 'tour_event',
    subjectId: tour.id,
    kind: 'tour',
    data: { event: 'synced_from_deal', dealId: deal.id, fields: Object.keys(patch) },
    origin,
  });
  return true;
}
