import { WON_REQUIRED_FIELDS, FIELD_LABELS_HE, missingFields } from './requiredFields.js';
import { emitTimelineEvent } from '../timeline/events.js';
import { seedTourComponents } from './tourComponents.js';
import { splitPlanAssignments, planComponentRows } from './planMaterialize.js';
import { scheduleGalleryCleanup } from './gallery/service.js';
import { syncDealRegistration } from './registrations.js';
import {
  calendarPendingPatch,
  patchTouchesCalendar,
  kickTourCalendarSync,
} from './calendar/service.js';

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
    // Canonical allocation row (source='deal') — the seat SSOT.
    await syncDealRegistration(tx, booking, slot);
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

  // private / business — the deal's own tour, seeded from its planning fields
  // + the DealTourPlan (the pre-WON planning layer). THE materialization point:
  // planned guides/components/notes become real HERE, exactly once, in the same
  // transaction as the tour itself. The plan row survives untouched — dormant
  // while the tour lives, refreshed from the tour if a reopen cancels it.
  const plan = await tx.dealTourPlan.findUnique({
    where: { dealId: deal.id },
    include: {
      assignments: {
        orderBy: { createdAt: 'asc' },
        include: { personRef: { select: { id: true, status: true, lifecycleHint: true } } },
      },
      activityComponents: { orderBy: { sortOrder: 'asc' } },
    },
  });

  // ONE real-world tour = ONE TourEvent (2026-07 lifecycle fix): a re-WON
  // after reopen/LOST REACTIVATES the deal's auto-cancelled tour instead of
  // creating a cancelled twin. The same row keeps its id — gallery,
  // questionnaires, payroll linkage, timeline and (when the sync worker
  // hasn't purged it yet) the Google event identity all survive. A NEW row
  // is created only when no reactivatable prior tour exists (first WON, or
  // the prior tour is completed / a group slot / a marked twin).
  const priorBooking = await tx.booking.findFirst({
    where: {
      dealId: deal.id,
      status: 'cancelled',
      tourEvent: {
        kind: { in: ['private', 'business'] },
        status: 'cancelled',
        supersededByTourEventId: null,
      },
    },
    orderBy: { cancelledAt: 'desc' },
    include: { tourEvent: true },
  });

  const coreData = {
    kind: deal.activityType,
    status: 'scheduled',
    date: deal.tourDate,
    startTime: deal.tourTime,
    productId: deal.productId,
    productVariantId: deal.productVariantId,
    locationId: deal.locationId,
    tourLanguage: deal.tourLanguage,
    notes: plan?.notes || null,
    // Scheduled (again) → the sync worker creates/patches the Google event.
    // Planned guides become assignments in THIS transaction, so the event
    // already carries them as attendees — one invitation wave.
    ...calendarPendingPatch(),
  };

  const reactivating = !!priorBooking;
  let tourEvent;
  if (reactivating) {
    tourEvent = await tx.tourEvent.update({
      where: { id: priorBooking.tourEventId },
      data: { ...coreData, cancelledAt: null, completedAt: null, completedReason: null },
    });
    // Converge the row's operational children onto the PLAN (the plan holds
    // the reopen-time copy plus any later edits — it is the desired state).
    // TourAssignment ids are loose refs from payroll (re-linked by person on
    // completion), so replace-all is safe and keeps the logic identical to
    // the create path.
    await tx.tourEventActivityComponent.deleteMany({ where: { tourEventId: tourEvent.id } });
    await tx.tourAssignment.deleteMany({ where: { tourEventId: tourEvent.id } });
  } else {
    tourEvent = await tx.tourEvent.create({ data: coreData });
  }
  // Kick fires after the caller's transaction commits (1.5s debounce); the
  // periodic tick covers the rare slower commit.
  kickTourCalendarSync();
  // Components: a CUSTOMIZED plan is authoritative (copy, locations included);
  // otherwise seed from the selected VARIANT's defaults exactly as before the
  // planning layer existed. Either way a copy — the tour owns them from here on.
  const componentRows = planComponentRows(plan, tourEvent.id);
  if (componentRows) {
    if (componentRows.length) {
      await tx.tourEventActivityComponent.createMany({ data: componentRows, skipDuplicates: true });
    }
  } else {
    await seedTourComponents(tx, tourEvent.id, deal.productVariantId);
  }
  // Planned team → REAL TourAssignments. Eligibility re-applies at this moment:
  // a guide who departed since planning is skipped (reported below), never
  // silently invited.
  const { create: plannedGuides, skipped: skippedGuides } = splitPlanAssignments(plan?.assignments);
  if (plannedGuides.length) {
    await tx.tourAssignment.createMany({
      data: plannedGuides.map((a) => ({
        tourEventId: tourEvent.id,
        personRefId: a.personRefId,
        externalPersonId: a.externalPersonId,
        displayName: a.displayName,
        role: a.role,
        notes: a.notes,
      })),
      skipDuplicates: true,
    });
  }
  if (plan && (plannedGuides.length || skippedGuides.length || plan.componentsCustomized || plan.notes)) {
    await emitTimelineEvent(tx, {
      subjectType: 'tour_event',
      subjectId: tourEvent.id,
      kind: 'tour',
      data: {
        event: 'plan_materialized',
        dealId: deal.id,
        guides: plannedGuides.map((a) => a.displayName),
        skippedGuides: skippedGuides.map((a) => a.displayName),
        componentsCustomized: plan.componentsCustomized,
      },
      origin,
    });
  }
  // History stays append-only: the cancelled booking row is preserved and a
  // fresh ACTIVE booking is created (the partial unique allows exactly one).
  const booking = await tx.booking.create({
    data: { tourEventId: tourEvent.id, dealId: deal.id, seats, status: 'active' },
  });
  // Canonical allocation row (source='deal') — the seat SSOT.
  await syncDealRegistration(tx, booking, tourEvent);
  const createdEvent = reactivating ? 'tour_reactivated' : 'tour_created';
  await emitTimelineEvent(tx, {
    subjectType: 'tour_event',
    subjectId: tourEvent.id,
    kind: 'tour',
    body: reactivating ? '♻️ הסיור הוחזר לפעיל — הדיל נסגר מחדש (אותו סיור, ללא כפילות)' : undefined,
    data: { event: createdEvent, dealId: deal.id, dealOrderNo: deal.orderNo, seats },
    origin,
  });
  await emitTimelineEvent(tx, {
    subjectType: 'deal',
    subjectId: deal.id,
    kind: 'tour',
    body: reactivating ? '♻️ הסיור הקיים הוחזר לפעיל (ללא יצירת סיור חדש)' : undefined,
    data: {
      event: createdEvent,
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
  // Mirror the cancellation onto the canonical registration (seats stop counting).
  await syncDealRegistration(tx, { ...booking, status: 'cancelled' }, booking.tourEvent);
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
  // Postponed tours auto-cancel too: a deal leaving its undated tour leaves
  // nothing operational to keep alive (same reopen/LOST/replace semantics).
  if (tour.kind !== 'group_slot' && (tour.status === 'scheduled' || tour.status === 'postponed')) {
    const remaining = await tx.booking.count({
      where: { tourEventId: tour.id, status: 'active' },
    });
    if (remaining === 0) {
      await tx.tourEvent.update({
        where: { id: tour.id },
        // Auto-cancel mirrors to the calendar exactly like a manual cancel:
        // the sync worker deletes the Google event → guides get cancellations.
        data: { status: 'cancelled', cancelledAt: new Date(), ...calendarPendingPatch() },
      });
      kickTourCalendarSync();
      await emitTimelineEvent(tx, {
        subjectType: 'tour_event',
        subjectId: tour.id,
        kind: 'tour',
        data: { event: 'auto_cancelled_empty', reason },
        origin,
      });
      // Same cleanup path as a manual cancel: revoke customer gallery links
      // now, purge R2 async (idempotent; no-op when no gallery was touched).
      await scheduleGalleryCleanup(tx, tour.id, { reason: 'tour_cancelled', origin });
    }
  }
}

// Return-to-planning (reopen-with-cancel, private/business): preserve the
// tour's OPERATIONAL state — team, components (+ workshop locations), notes —
// back onto the deal's DealTourPlan before the tour is cancelled. The plan is
// REPLACED (the tour is the operational truth at this moment), and
// componentsCustomized is set: the copied list is authoritative, so a future
// WON recreates the tour exactly as it was — nothing to configure again.
export async function copyTourStateToPlan(tx, dealId, tourEventId) {
  const [assignments, components, tour] = await Promise.all([
    tx.tourAssignment.findMany({ where: { tourEventId }, orderBy: { createdAt: 'asc' } }),
    tx.tourEventActivityComponent.findMany({
      where: { tourEventId },
      orderBy: { sortOrder: 'asc' },
    }),
    tx.tourEvent.findUnique({ where: { id: tourEventId }, select: { notes: true } }),
  ]);
  const plan = await tx.dealTourPlan.upsert({
    where: { dealId },
    create: { dealId },
    update: {},
  });
  await tx.dealTourPlanAssignment.deleteMany({ where: { planId: plan.id } });
  await tx.dealTourPlanActivityComponent.deleteMany({ where: { planId: plan.id } });
  if (assignments.length) {
    await tx.dealTourPlanAssignment.createMany({
      data: assignments.map((a) => ({
        planId: plan.id,
        personRefId: a.personRefId,
        externalPersonId: a.externalPersonId,
        displayName: a.displayName,
        role: a.role,
        notes: a.notes,
      })),
    });
  }
  if (components.length) {
    await tx.dealTourPlanActivityComponent.createMany({
      data: components.map((c, i) => ({
        planId: plan.id,
        activityComponentId: c.activityComponentId,
        workshopLocationId: c.workshopLocationId,
        sortOrder: i,
      })),
    });
  }
  await tx.dealTourPlan.update({
    where: { id: plan.id },
    data: { notes: tour?.notes || null, componentsCustomized: true },
  });
  return { guides: assignments.length, components: components.length };
}

// Keep-the-tour path on reopen: the booking becomes an intentional ORPHAN —
// disconnected operational work, surfaced by the global header warning until
// reconnected or cancelled.
export async function orphanDealBooking(tx, booking, { origin }) {
  await tx.booking.update({
    where: { id: booking.id },
    data: { status: 'orphaned', orphanedAt: new Date() },
  });
  // Orphaned seats do not count — collapse the registration to non-active.
  await syncDealRegistration(tx, { ...booking, status: 'orphaned' }, booking.tourEvent);
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
  // Seats count again — restore the canonical registration to active.
  await syncDealRegistration(tx, { ...booking, status: 'active' }, booking.tourEvent);
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

// ── Pending Tour Update (the ONE concept) ────────────────────────────────────
// After a private/business tour exists, the Deal's planning fields are the
// DESIRED state and the TourEvent/Booking are the APPLIED state. The pending
// update is simply their DIFF — derived, never stored, so it can never go
// stale, and any future tour-affecting field joins by appearing here (and in
// syncDealToTour, which is what "apply" runs). Group slots never have pending
// updates: their planning fields are slot-owned and locked on the deal.
// Mirrors syncDealToTour's semantics exactly — applying must always empty
// this list. Date/time semantics (postpone / reschedule — see syncDealToTour):
//   * scheduled tour + CLEARED deal date → pends as a postpone;
//   * postponed tour + deal date AND time set → pends as a reschedule
//     (a date without a time never pends — scheduling needs both);
//   * otherwise a cleared deal time alone never syncs, so never pends.
// Returns [{ field, labelHe, dealValue, tourValue }].
export function pendingTourUpdate(deal, booking) {
  if (!deal || !booking || booking.status !== 'active') return [];
  const tour = booking.tourEvent;
  if (!tour || tour.kind === 'group_slot') return [];
  if (tour.status !== 'scheduled' && tour.status !== 'postponed') return [];
  const diffs = [];
  const push = (field, dealValue, tourValue) =>
    diffs.push({ field, labelHe: FIELD_LABELS_HE[field] || field, dealValue, tourValue });
  if (tour.status === 'postponed') {
    if (deal.tourDate && deal.tourTime) {
      push('tourDate', deal.tourDate, tour.date);
      push('tourTime', deal.tourTime, tour.startTime);
    }
  } else if (!deal.tourDate) {
    push('tourDate', null, tour.date);
    if (tour.startTime) push('tourTime', null, tour.startTime);
  } else {
    if (deal.tourDate !== tour.date) push('tourDate', deal.tourDate, tour.date);
    if (deal.tourTime && deal.tourTime !== tour.startTime) push('tourTime', deal.tourTime, tour.startTime);
  }
  if ((deal.tourLanguage || null) !== (tour.tourLanguage || null))
    push('tourLanguage', deal.tourLanguage || null, tour.tourLanguage || null);
  if ((deal.productId || null) !== (tour.productId || null))
    push('productId', deal.productId || null, tour.productId || null);
  if ((deal.productVariantId || null) !== (tour.productVariantId || null))
    push('productVariantId', deal.productVariantId || null, tour.productVariantId || null);
  if ((deal.locationId || null) !== (tour.locationId || null))
    push('locationId', deal.locationId || null, tour.locationId || null);
  const seats = Number(deal.participants);
  if (Number.isInteger(seats) && seats >= 1 && seats !== booking.seats)
    push('participants', seats, booking.seats);
  return diffs;
}

// Mechanical Deal→Tour mirror for private/business tours (+ seats for both
// kinds). The DEAL is the desired state; since the pending-update flow this is
// invoked by the EXPLICIT "עדכון סיור" orchestration (and by group saves for
// the seats mirror / orphan reconnect) — no longer by every deal save.
//
// Postpone / reschedule (the ONLY writers of status='postponed'):
//   * scheduled tour + CLEARED deal date → the tour is not happening as
//     scheduled and no replacement was chosen: SAME TourEvent, date/time
//     cleared, status='postponed'. Team/components/notes/questionnaires/
//     gallery/booking all stay. The calendar mark makes the sync worker
//     delete the Google event (guides get Google's cancellation email).
//   * postponed tour + deal date AND time set → back to 'scheduled'; the
//     worker creates a fresh Google event with the current guides.
// This is NOT deal-reopen: reopen cancels the tour and copies state to the
// plan; postpone keeps the operational tour alive without a date.
// Returns true when the tour row actually changed.
export async function syncDealToTour(tx, deal, booking, { origin }) {
  const tour = booking.tourEvent;

  // seats always mirror participants (both tour kinds).
  const seats = Number(deal.participants);
  const effectiveSeats = Number.isInteger(seats) && seats >= 1 ? seats : booking.seats;
  if (effectiveSeats !== booking.seats) {
    await tx.booking.update({ where: { id: booking.id }, data: { seats: effectiveSeats } });
  }

  // Keep the canonical registration in step with the deal's current seats and
  // (for private/business) operational variant — the seat/derivation SSOT.
  const syncRegistration = (productVariantId) =>
    syncDealRegistration(
      tx,
      { ...booking, seats: effectiveSeats, status: 'active' },
      { ...tour, productVariantId },
    );

  if (tour.kind === 'group_slot') {
    await syncRegistration(tour.productVariantId); // variant is slot-owned
    return false; // slot planning is slot-owned
  }

  const patch = {};
  const postpone = tour.status === 'scheduled' && !deal.tourDate;
  const reschedule = tour.status === 'postponed' && !!deal.tourDate && !!deal.tourTime;
  if (postpone) {
    patch.date = null;
    patch.startTime = null;
    patch.status = 'postponed';
  } else if (reschedule) {
    patch.date = deal.tourDate;
    patch.startTime = deal.tourTime;
    patch.status = 'scheduled';
  } else {
    if (deal.tourDate && deal.tourDate !== tour.date) patch.date = deal.tourDate;
    if (deal.tourTime && deal.tourTime !== tour.startTime) patch.startTime = deal.tourTime;
  }
  if ((deal.tourLanguage || null) !== tour.tourLanguage) patch.tourLanguage = deal.tourLanguage || null;
  if ((deal.productId || null) !== tour.productId) patch.productId = deal.productId || null;
  if ((deal.productVariantId || null) !== tour.productVariantId)
    patch.productVariantId = deal.productVariantId || null;
  if ((deal.locationId || null) !== tour.locationId) patch.locationId = deal.locationId || null;

  const effectiveVariantId = Object.prototype.hasOwnProperty.call(patch, 'productVariantId')
    ? patch.productVariantId
    : tour.productVariantId;

  if (!Object.keys(patch).length) {
    await syncRegistration(effectiveVariantId);
    return false;
  }
  // Deal-driven date/time/variant/language/status changes are calendar-visible.
  const calendarDirty = patchTouchesCalendar(patch);
  if (calendarDirty) Object.assign(patch, calendarPendingPatch());
  await tx.tourEvent.update({ where: { id: tour.id }, data: patch });
  if (calendarDirty) kickTourCalendarSync();
  await emitTimelineEvent(tx, {
    subjectType: 'tour_event',
    subjectId: tour.id,
    kind: 'tour',
    data: { event: 'synced_from_deal', dealId: deal.id, fields: Object.keys(patch) },
    origin,
  });
  if (patch.status === 'postponed') {
    await emitTimelineEvent(tx, {
      subjectType: 'tour_event',
      subjectId: tour.id,
      kind: 'tour',
      body: '⏸️ הסיור נדחה — המועד הוסר וטרם נקבע מועד חדש',
      data: { event: 'postponed', previousDate: tour.date, previousStartTime: tour.startTime },
      origin,
    });
  } else if (patch.status === 'scheduled') {
    await emitTimelineEvent(tx, {
      subjectType: 'tour_event',
      subjectId: tour.id,
      kind: 'tour',
      body: `🗓️ נקבע מועד חדש לסיור נדחה — ${patch.date} · ${patch.startTime}`,
      data: { event: 'rescheduled', date: patch.date, startTime: patch.startTime },
      origin,
    });
  }
  await syncRegistration(effectiveVariantId);
  return true;
}
