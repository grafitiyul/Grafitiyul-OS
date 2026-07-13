import { CAPACITY_STATUSES } from './registrationStatus.js';
import { recomputeTourOperationalProduct } from './operationalProduct.js';
import { calendarPendingPatch, kickTourCalendarSync } from './calendar/service.js';
import { wooPendingPatch, kickWooSync } from './woo/service.js';
import { emitTourChangeImpact } from './changeImpact.js';
import { emitTimelineEvent } from '../timeline/events.js';
import { cancelTourAssignments } from './assignmentLifecycle.js';

// Canonical registered-tour mutation. A TourEvent that holds seats (active/held/
// confirmed registrations) must NEVER be silently re-dated/moved: instead we
// create a REPLACEMENT occurrence and move everything to it, so Deals,
// registrations, Woo, Calendar and Operations Control all stay consistent. This
// is the ONE service every "move a registered tour" path funnels through.

const COPY_FIELDS = [
  'date', 'startTime', 'tourLanguage', 'capacity',
  'productId', 'productVariantId', 'locationId', 'meetingPoint', 'openTourTemplateId',
];

// Seat-holding registrations on a tour (active + held + confirmed).
export async function registeredSeatCount(client, tourEventId) {
  const agg = await client.ticketRegistration.aggregate({
    where: { tourEventId, status: { in: CAPACITY_STATUSES } },
    _sum: { quantity: true },
    _count: { _all: true },
  });
  return { seats: agg._sum.quantity || 0, count: agg._count._all || 0 };
}

// Replace a registered TourEvent. Idempotent: a retry returns the existing
// replacement (never a second tour / duplicated registrations). Moves seat
// registrations + active bookings, realigns each moved Deal's snapshot, cancels
// the original (linked to the replacement), recomputes the replacement's
// operational product, marks Woo + Calendar dirty on both, and emits ONE
// canonical impact issue.
export async function replaceTourEvent(client, { originalId, patch = {}, origin = null }) {
  const original = await client.tourEvent.findUnique({ where: { id: originalId } });
  if (!original) {
    const e = new Error('not_found');
    e.code = 'not_found';
    throw e;
  }
  if (original.kind !== 'group_slot') {
    const e = new Error('not_a_group_slot');
    e.code = 'not_a_group_slot';
    throw e;
  }

  // Idempotency: already replaced → return the existing replacement, no-op.
  if (original.replacedByTourEventId) {
    const existing = await client.tourEvent.findUnique({ where: { id: original.replacedByTourEventId } });
    if (existing) return { original, replacement: existing, dealIds: [], reused: true };
  }

  const out = await client.$transaction(async (tx) => {
    // 1. Create the replacement (copy original fields, apply the patch).
    const createData = { kind: 'group_slot', status: 'scheduled', cancelledAt: null, generatedByRuleId: null };
    for (const f of COPY_FIELDS) createData[f] = original[f];
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) createData[k] = v;
    Object.assign(createData, calendarPendingPatch(), wooPendingPatch());
    const replacement = await tx.tourEvent.create({ data: createData });

    // 2. Move seat registrations (preserve status / breakdown / quantity).
    await tx.ticketRegistration.updateMany({
      where: { tourEventId: originalId, status: { in: CAPACITY_STATUSES } },
      data: { tourEventId: replacement.id },
    });

    // 3. Move active bookings + 4. realign each moved Deal's tour snapshot.
    const bookings = await tx.booking.findMany({
      where: { tourEventId: originalId, status: 'active' },
      select: { dealId: true },
    });
    await tx.booking.updateMany({
      where: { tourEventId: originalId, status: 'active' },
      data: { tourEventId: replacement.id },
    });
    const dealIds = [...new Set(bookings.map((b) => b.dealId).filter(Boolean))];
    for (const dealId of dealIds) {
      await tx.deal.update({
        where: { id: dealId },
        data: {
          tourDate: replacement.date,
          tourTime: replacement.startTime,
          tourLanguage: replacement.tourLanguage,
          locationId: replacement.locationId,
        },
      });
      await emitTimelineEvent(tx, {
        subjectType: 'deal', subjectId: dealId, kind: 'tour',
        data: { event: 'tour_moved', tourEventId: replacement.id, from: { date: original.date, startTime: original.startTime }, to: { date: replacement.date, startTime: replacement.startTime } },
        origin,
      });
    }

    // 7. Cancel the original + link it to the replacement (readable in history).
    await tx.tourEvent.update({
      where: { id: originalId },
      data: { status: 'cancelled', cancelledAt: new Date(), replacedByTourEventId: replacement.id, ...calendarPendingPatch(), ...wooPendingPatch() },
    });
    await emitTimelineEvent(tx, {
      subjectType: 'tour_event', subjectId: originalId, kind: 'tour',
      data: { event: 'tour_replaced', replacementId: replacement.id, from: { date: original.date, startTime: original.startTime }, to: { date: replacement.date, startTime: replacement.startTime } },
      origin,
    });
    // The original is cancelled → remove its staff (assignments are NOT moved to
    // the replacement; the new occurrence is re-staffed via the plan layer). This
    // prevents the same active assignment sitting on both tours.
    await cancelTourAssignments(tx, originalId, { origin, reason: 'tour_replaced' });
    return { replacement, dealIds };
  });

  // 9. Recompute the replacement's operational product from its (moved) regs.
  await recomputeTourOperationalProduct(client, out.replacement.id, { force: true }).catch((e) => console.error('[replace] recompute failed', e?.message));
  // 11. ONE canonical impact issue — customers now sit on the replacement.
  await emitTourChangeImpact(client, {
    tourEventId: out.replacement.id,
    impactType: 'tour_moved',
    before: { date: original.date, startTime: original.startTime },
    after: { date: out.replacement.date, startTime: out.replacement.startTime },
    note: 'registered tour replacement',
  }).catch((e) => console.error('[replace] impact emit failed', e?.message));
  // 10. Woo + Calendar already marked dirty on both; kick the workers.
  kickTourCalendarSync();
  kickWooSync();

  return { original, replacement: out.replacement, dealIds: out.dealIds, reused: false };
}
