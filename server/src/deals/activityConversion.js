// ── THE canonical activity-type conversion ──────────────────────────────────
//
// Changing what a Deal IS — a group seat, a private tour, a business event — is
// not a field edit once the deal has operational state. It cancels a booking,
// releases or consumes seats on a real tour, creates or joins a TourEvent,
// moves stock on WooCommerce, rewrites a Google Calendar event, re-times future
// customer messages and changes what the customer is actually booked for.
//
// Every other dangerous transition in GOS already routes through a canonical
// service — WON (wonTransition.js), LOST/reopen (the deals router), moving a
// registered tour (replaceTour.js), deleting (deleteGuard.js). Activity type
// was the one left as a dropdown, and the gap was real: flipping a WON group
// deal to 'private' left the Booking active on the group slot, the
// TicketRegistration still consuming a seat, Woo still showing it sold — and
// nothing detected it, because pendingTourUpdate() early-returns on a group
// slot and wonGate only runs on a WON transition.
//
// ── This module ORCHESTRATES; it does not reimplement ───────────────────────
//
// Almost everything a conversion needs already exists and is canonical. The
// value here is sequencing those writers correctly and atomically, not new
// machinery:
//
//   createTourForWonDeal   create the private/business tour, or join the slot
//                          (capacity guard, allowOverbook, plan materialization,
//                          reactivate-don't-twin, registration sync)
//   cancelDealBooking      release the old booking + seats, auto-cancel an
//                          emptied private/business tour, gallery cleanup
//   copyTourStateToPlan    preserve guides/components/notes before cancelling
//   syncDealRegistration   the seat SSOT (called by both of the above)
//   markTourWooPending     Woo stock — already fired by the registration sync
//   calendarPendingPatch   Google Calendar — already fired by tour create/cancel
//   normalizeClassification the organization rule
//   computeCollection      the money picture (payments are never touched)
//
// The only genuinely new pieces are the delivery reconciliation
// (communication/reconcileDealTour.js) and the audit/idempotency identity.
//
// ── The three modes ─────────────────────────────────────────────────────────
//
//   update_kind   private ⇄ business. The SAME TourEvent, `kind` updated in
//                 place. Nothing in the server branches private-vs-business
//                 operationally — every operational branch is group_slot vs not
//                 — so the difference is a label on the calendar summary and in
//                 the guide portal. Replacing the tour would destroy the
//                 gallery, questionnaires, payroll linkage and the Google event
//                 identity to change a label. Smallest correct mutation.
//
//   join_slot     private/business → group. The old private tour is released
//                 (and auto-cancels when it empties); the deal joins an
//                 operator-CHOSEN slot. A slot is never guessed.
//
//   replace_tour  group → private/business. The deal leaves the slot — which
//                 stays alive, other customers are on it — and gets its own
//                 tour.
//
// ── What conversion NEVER touches ───────────────────────────────────────────
//
// Deal identity, contacts, organization (unless the operator explicitly asks),
// payments, IcountDocuments, collection evidence, timeline history. The deal
// is the same commercial deal; only its operational and commercial STRUCTURE
// changes. Money survives for free precisely because this module never writes
// to those tables — computeCollection re-derives the balance from the unchanged
// evidence against the (possibly new) Deal.valueMinor.

import { prisma as defaultPrisma } from '../db.js';
import { emitTimelineEvent } from '../timeline/events.js';
import {
  ACTIVITY_TYPES,
  ACTIVITY_TO_TOUR_KIND,
  ACTIVITY_TYPE_LABELS_HE,
} from '../../../shared/dealActivity.mjs';
import {
  activeBookingFor,
  createTourForWonDeal,
  cancelDealBooking,
  copyTourStateToPlan,
  wonGate,
} from '../tours/tourFromDeal.js';
import { occupancyFor } from '../tours/occupancy.js';
import { CAPACITY_STATUSES } from '../tours/registrationStatus.js';
import { calendarPendingPatch, kickTourCalendarSync } from '../tours/calendar/service.js';
import { kickWooSync } from '../tours/woo/service.js';
import { kickPayrollReconcile } from '../payroll/service.js';
import { dealCollection } from '../collection.js';
import { normalizeClassification } from './classification.js';
import {
  parkDealTourDeliveries,
  finalizeDealTourDeliveries,
  pendingDeliveryCount,
} from '../communication/reconcileDealTour.js';

/** Thrown for every refusal. `code` is what the route turns into an error body. */
export class ConversionError extends Error {
  constructor(code, details = null) {
    super(code);
    this.code = code;
    this.details = details;
  }
}

const coded = (code, details) => new ConversionError(code, details);

/** The deal fields conversion reads. */
export const CONVERSION_DEAL_SELECT = {
  id: true, orderNo: true, status: true, activityType: true, activityTypeAssumedAt: true,
  organizationId: true, organizationTypeId: true, organizationSubtypeId: true,
  productId: true, productVariantId: true, locationId: true,
  tourDate: true, tourTime: true, participants: true, tourLanguage: true,
  valueMinor: true, currency: true, collectionReview: true,
  conversionOpId: true,
};

// ── The matrix ──────────────────────────────────────────────────────────────
// Which structural operation each ordered pair requires. This table IS the
// contract: a new activity type joins the system by appearing here, and no
// caller may infer a mode any other way.
const GROUPY = new Set(['group']);
const DEDICATED = new Set(['private', 'business']);

/**
 * The structural mode for a conversion. Pure — the whole matrix in one function.
 *
 *   private ⇄ business            → update_kind   (same tour, kind relabelled)
 *   private/business → group      → join_slot     (explicit slot required)
 *   group → private/business      → replace_tour  (the slot lives on)
 */
export function conversionMode(from, to) {
  if (!ACTIVITY_TYPES.includes(to)) throw coded('invalid_activity_type');
  if (from === to) throw coded('same_activity_type');
  if (DEDICATED.has(from) && DEDICATED.has(to)) return 'update_kind';
  if (DEDICATED.has(from) && GROUPY.has(to)) return 'join_slot';
  if (GROUPY.has(from) && DEDICATED.has(to)) return 'replace_tour';
  // An unclassified deal converting INTO something: it has no structure to
  // move, so the target's own creation path applies.
  return GROUPY.has(to) ? 'join_slot' : 'replace_tour';
}

/**
 * Does this deal have operational state that makes a plain field edit unsafe?
 *
 * THE predicate the deals router uses to decide between the dropdown and the
 * conversion flow (and the ONE definition of "operational state" for this
 * feature — never re-derived at a call site). A deal with neither an active
 * booking nor a capacity-holding registration has nothing to reconcile, so the
 * ordinary edit stays available and the common case keeps its one click.
 */
export async function hasOperationalState(client, dealId) {
  const [booking, seats] = await Promise.all([
    client.booking.count({ where: { dealId, status: 'active' } }),
    client.ticketRegistration.count({
      where: { dealId, status: { in: CAPACITY_STATUSES } },
    }),
  ]);
  return booking > 0 || seats > 0;
}

// ── PREVIEW ─────────────────────────────────────────────────────────────────

/**
 * Everything the operator must see before committing. PURE READ — this function
 * writes nothing, ever, and its verdict is advice: every blocker it reports is
 * re-evaluated inside the confirm transaction, which is the only authority.
 */
export async function previewConversion(
  client,
  { dealId, targetActivityType, tourEventId = null, allowOverbook = false, organizationChoice = null },
) {
  const deal = await client.deal.findUnique({
    where: { id: dealId },
    select: { ...CONVERSION_DEAL_SELECT, organization: { select: { id: true, name: true } } },
  });
  if (!deal) throw coded('not_found');

  const from = deal.activityType || null;
  const to = targetActivityType;
  const mode = conversionMode(from, to);

  const booking = await activeBookingFor(client, dealId);
  const currentTour = booking?.tourEvent || null;
  const targetSlot = tourEventId
    ? await client.tourEvent.findUnique({ where: { id: tourEventId } })
    : null;

  const blockers = [];
  const warnings = [];

  // ── requirements ──────────────────────────────────────────────────────────
  // The WON gate is the canonical required-field list per activity type. It
  // applies to a WON deal only: an OPEN deal has nothing operational to keep
  // coherent and may be under-specified.
  const gate = wonGate({ ...deal, activityType: to }, tourEventId);
  const missingFields = deal.status === 'won' ? gate.missing : [];
  if (missingFields.length) {
    blockers.push({ code: 'won_requirements_missing', fields: missingFields });
  }

  // Same rule as confirm: only a deal that actually carries operational
  // structure (WON, or already booked) needs a slot chosen for it.
  const needsStructure = deal.status === 'won' || !!booking;
  const needsSlot = mode === 'join_slot' && needsStructure;
  if (needsSlot && !targetSlot) {
    blockers.push({ code: 'tour_slot_required' });
  } else if (needsSlot && targetSlot) {
    if (targetSlot.kind !== 'group_slot') blockers.push({ code: 'tour_slot_invalid' });
    else if (targetSlot.status !== 'scheduled') blockers.push({ code: 'tour_slot_not_scheduled' });
  }

  // ── organization ──────────────────────────────────────────────────────────
  // An organization is WHO PAYS, not WHAT IS DELIVERED, so it never blocks a
  // conversion away from business — the operator decides its fate explicitly
  // (organizationChoice: 'keep' | 'remove'), and nothing happens by default.
  const orgDecisionRequired = !!deal.organizationId && to !== 'business';
  if (orgDecisionRequired && !organizationChoice) {
    blockers.push({ code: 'organization_choice_required', organizationName: deal.organization?.name || null });
  }
  if (to === 'business' && !deal.organizationId) {
    warnings.push({
      code: 'business_without_organization',
      messageHe: 'הדיל יסווג כעסקי ללא ארגון מקושר. אפשר לקשר ארגון מכותרת הדיל.',
    });
  }

  // ── capacity ──────────────────────────────────────────────────────────────
  // The canonical seat truth, with the deal's own held reservation excluded
  // exactly as createTourForWonDeal excludes it — the same arithmetic, so the
  // preview can never promise what confirm then refuses.
  let capacity = null;
  if (targetSlot?.kind === 'group_slot') {
    capacity = await slotCapacityCheck(client, {
      slot: targetSlot,
      dealId,
      seats: Number(deal.participants) || 0,
    });
    if (!capacity.fits && !allowOverbook) {
      blockers.push({ code: 'tour_full', ...capacity });
    }
  }

  // ── money (never mutated — only reported) ─────────────────────────────────
  const money = await dealCollection(client, deal);

  // ── consequences the operator has a right to know ─────────────────────────
  if (mode === 'replace_tour') {
    const guides = await client.tourAssignment.count({ where: { tourEventId: currentTour?.id || '' } });
    warnings.push({
      code: 'new_tour_needs_staffing',
      messageHe: guides
        ? 'הסיור החדש ייווצר לפי תכנון הדיל — יש לוודא שיבוץ מדריכים.'
        : 'לסיור החדש עדיין לא משובצים מדריכים.',
    });
  }
  if (mode === 'join_slot' && currentTour) {
    warnings.push({
      code: 'private_tour_released',
      messageHe: 'הסיור הייעודי הקיים ישוחרר; צוות, רכיבים והערות יישמרו בתכנון הדיל וניתן יהיה לשחזרם.',
    });
  }
  const pendingMessages = currentTour
    ? await pendingDeliveryCount(client, { dealId, tourEventId: currentTour.id })
    : 0;
  if (pendingMessages) {
    warnings.push({
      code: 'pending_messages_reconciled',
      count: pendingMessages,
      messageHe: `${pendingMessages} מסרים עתידיים מתוזמנים יחושבו מחדש לפי הסיור החדש, או יבוטלו אם אינם חלים עוד.`,
    });
  }

  return {
    dealId,
    orderNo: deal.orderNo,
    mode,
    from,
    to,
    fromLabelHe: from ? ACTIVITY_TYPE_LABELS_HE[from] : 'ללא סוג פעילות',
    toLabelHe: ACTIVITY_TYPE_LABELS_HE[to],
    current: {
      tourEvent: currentTour && {
        id: currentTour.id, kind: currentTour.kind, status: currentTour.status,
        date: currentTour.date, startTime: currentTour.startTime,
        productVariantId: currentTour.productVariantId, locationId: currentTour.locationId,
      },
      bookingId: booking?.id || null,
      seats: booking?.seats ?? null,
      participants: deal.participants,
      organization: deal.organization || null,
    },
    target: {
      tourEvent: targetSlot && {
        id: targetSlot.id, kind: targetSlot.kind, status: targetSlot.status,
        date: targetSlot.date, startTime: targetSlot.startTime, capacity: targetSlot.capacity,
      },
    },
    requires: {
      slotSelection: needsSlot,
      organizationDecision: orgDecisionRequired,
      missingFields,
    },
    capacity,
    money: {
      totalMinor: money.totalMinor,
      paidMinor: money.paidMinor,
      balanceMinor: money.balanceMinor,
      currency: money.currency,
      status: money.status,
    },
    plan: buildPlanSteps({ mode, currentTour, targetSlot, from, to, organizationChoice }),
    warnings,
    blockers,
    canConvert: blockers.length === 0,
  };
}

// The capacity arithmetic, isolated so PREVIEW and CONFIRM share one copy.
// The deal's OWN held reservation already counts in occupancy; confirming it
// adds no new seats, so it is subtracted — otherwise a legitimate conversion is
// refused for seats the deal already holds.
async function slotCapacityCheck(client, { slot, dealId, seats }) {
  if (slot.capacity == null) {
    return { slotId: slot.id, capacity: null, activeSeats: null, requested: seats, fits: true };
  }
  const occ = await occupancyFor(client, [slot.id]);
  let current = occ[slot.id]?.activeSeats || 0;
  const own = await client.ticketRegistration.aggregate({
    where: { dealId, tourEventId: slot.id, status: { in: CAPACITY_STATUSES } },
    _sum: { quantity: true },
  });
  current -= own._sum.quantity || 0;
  return {
    slotId: slot.id,
    capacity: slot.capacity,
    activeSeats: current,
    requested: seats,
    fits: current + seats <= slot.capacity,
  };
}

// Human-readable, ordered, in Hebrew — the operator reads exactly what will
// happen before it happens. Derived from the mode, never hand-maintained per
// screen.
function buildPlanSteps({ mode, currentTour, targetSlot, from, to, organizationChoice }) {
  const when = (t) => (t?.date ? `${t.date}${t.startTime ? ' ' + t.startTime : ''}` : 'ללא מועד');
  const steps = [];
  if (mode === 'update_kind') {
    steps.push(`הסיור הקיים (${when(currentTour)}) יישאר בדיוק כפי שהוא — רק הסיווג ישתנה.`);
    steps.push('הגלריה, השאלונים, השכר, השיבוצים ואירוע היומן נשמרים ללא שינוי.');
  }
  if (mode === 'replace_tour') {
    steps.push(`ההזמנה בסיור הקבוצתי (${when(currentTour)}) תבוטל והמקומות ישוחררו.`);
    steps.push('המלאי בחנות יתעדכן בהתאם.');
    steps.push('ייווצר סיור ייעודי חדש לדיל לפי פרטי הסיור שבדיל.');
  }
  if (mode === 'join_slot') {
    if (currentTour) {
      steps.push('צוות, רכיבים והערות הסיור הקיים יישמרו בתכנון הדיל.');
      steps.push(`הסיור הייעודי (${when(currentTour)}) ישוחרר ויבוטל אם לא נותרו בו הזמנות.`);
    }
    steps.push(`הדיל ישובץ לסיור הקבוצתי שנבחר (${when(targetSlot)}) והמקומות ייתפסו.`);
  }
  steps.push(`סוג הפעילות ישתנה מ-${from ? ACTIVITY_TYPE_LABELS_HE[from] : 'ללא סוג'} ל-${ACTIVITY_TYPE_LABELS_HE[to]}.`);
  if (organizationChoice === 'remove') steps.push('הארגון המקושר יוסר מהדיל.');
  if (organizationChoice === 'keep') steps.push('הארגון יישאר מקושר לדיל (לחשבונית ולהיסטוריה).');
  steps.push('התשלומים, המסמכים החשבונאיים והיסטוריית הדיל נשמרים במלואם.');
  steps.push('מסרים עתידיים מתוזמנים יחושבו מחדש או יבוטלו לפי המצב החדש.');
  steps.push('היומן, המלאי והשכר יתעדכנו מיד לאחר הביצוע.');
  return steps;
}

// ── CONFIRM ─────────────────────────────────────────────────────────────────

/**
 * Perform the conversion.
 *
 * One transaction for everything that must be atomic; every external effect is
 * post-commit and separately retryable. Refusals happen BEFORE the first write,
 * so a blocked conversion leaves the deal byte-identical.
 *
 * `opId` is the idempotency identity: re-sending the same one returns the
 * previous outcome without doing anything again (guarded at the DB by the
 * unique index on Deal.conversionOpId, so two concurrent requests cannot both
 * win). Callers must generate it once per operator intent, not per retry.
 */
export async function convertDealActivityType(
  {
    dealId,
    targetActivityType,
    tourEventId = null,
    allowOverbook = false,
    organizationChoice = null,
    opId,
    origin = null,
    actorUserId = null,
  },
  { db = defaultPrisma } = {},
) {
  if (!opId) throw coded('conversion_op_id_required');

  // Idempotency, cheap path: this exact operation already ran.
  const prior = await db.deal.findUnique({
    where: { conversionOpId: opId },
    select: { id: true, activityType: true, orderNo: true },
  });
  if (prior) {
    if (prior.id !== dealId) throw coded('conversion_op_id_conflict');
    return { alreadyDone: true, dealId, activityType: prior.activityType, deliveryIds: [] };
  }

  const out = await db.$transaction(async (tx) => {
    const deal = await tx.deal.findUnique({ where: { id: dealId }, select: CONVERSION_DEAL_SELECT });
    if (!deal) throw coded('not_found');

    const from = deal.activityType || null;
    const to = targetActivityType;
    const mode = conversionMode(from, to);

    const booking = await activeBookingFor(tx, dealId);
    const oldTour = booking?.tourEvent || null;

    // ── every guard, re-evaluated here where it is authoritative ────────────
    if (deal.status === 'won') {
      const gate = wonGate({ ...deal, activityType: to }, tourEventId);
      if (gate.missing.length) throw coded('won_requirements_missing', { missing: gate.missing });
    }

    // A tour exists only for a WON deal (see `structural` below): an OPEN deal
    // with no booking converts as a pure classification change, so it must not
    // be asked for a slot it would have nowhere to put.
    const needsStructure = deal.status === 'won' || !!booking;

    let targetSlot = null;
    if (mode === 'join_slot' && needsStructure) {
      if (!tourEventId) throw coded('tour_slot_required');
      targetSlot = await tx.tourEvent.findUnique({ where: { id: tourEventId } });
      if (!targetSlot || targetSlot.kind !== 'group_slot') throw coded('tour_slot_invalid');
      if (targetSlot.status !== 'scheduled') throw coded('tour_slot_not_scheduled');
      if (!allowOverbook) {
        const cap = await slotCapacityCheck(tx, {
          slot: targetSlot, dealId, seats: Number(deal.participants) || 0,
        });
        // Capacity is checked BEFORE any write, so a full slot leaves the deal
        // untouched rather than half-converted.
        if (!cap.fits) throw coded('tour_full', cap);
      }
    }

    if (deal.organizationId && to !== 'business' && !organizationChoice) {
      throw coded('organization_choice_required');
    }

    // ── the organization patch (explicit operator decision only) ────────────
    const removingOrg = !!deal.organizationId && to !== 'business' && organizationChoice === 'remove';
    const resultingOrgId = removingOrg ? null : deal.organizationId;
    const classification = normalizeClassification({
      organizationId: resultingOrgId,
      activityType: to,
      organizationTypeId: deal.organizationTypeId,
      organizationSubtypeId: deal.organizationSubtypeId,
      orgTypeId: resultingOrgId
        ? (await tx.organization.findUnique({
            where: { id: resultingOrgId }, select: { organizationTypeId: true },
          }))?.organizationTypeId || null
        : null,
      subtypeTypeId: deal.organizationSubtypeId
        ? (await tx.organizationSubtype.findUnique({
            where: { id: deal.organizationSubtypeId }, select: { organizationTypeId: true },
          }))?.organizationTypeId || null
        : null,
    });

    const before = {
      activityType: from,
      tourEventId: oldTour?.id || null,
      tourKind: oldTour?.kind || null,
      date: oldTour?.date || null,
      startTime: oldTour?.startTime || null,
      seats: booking?.seats ?? null,
      totalMinor: deal.valueMinor?.toString?.() ?? null,
      organizationId: deal.organizationId,
    };

    // ── the structural change ───────────────────────────────────────────────
    let newTour = oldTour;
    let seatsReleased = false;
    let seatsAllocated = false;
    let planPreserved = null;

    // An OPEN deal with no booking has no operational structure to move, so the
    // conversion is exactly a classification change — creating a tour here would
    // invent operational state that the WON transition alone may create.
    if (mode === 'update_kind' || !needsStructure) {
      // The smallest correct mutation: same TourEvent, new label. The calendar
      // summary is derived from `kind`, so the mirror is marked dirty and the
      // worker re-titles the existing Google event in place.
      if (mode === 'update_kind' && oldTour && oldTour.kind !== ACTIVITY_TO_TOUR_KIND[to]) {
        newTour = await tx.tourEvent.update({
          where: { id: oldTour.id },
          data: { kind: ACTIVITY_TO_TOUR_KIND[to], ...calendarPendingPatch() },
        });
      }
      await tx.deal.update({
        where: { id: dealId },
        data: dealPatch(classification, { opId, removingOrg }),
      });
    } else {
      // Order is forced by the DB: Booking_one_active_per_deal_key is a partial
      // unique on (dealId) WHERE status='active', so the old booking must be
      // cancelled before the new one exists.
      if (booking && oldTour) {
        // Leaving a DEDICATED tour: preserve its operational state onto the
        // deal's plan first, exactly as reopen-with-remove does, so converting
        // back restores the team and components instead of rebuilding them.
        if (oldTour.kind !== 'group_slot') {
          planPreserved = await copyTourStateToPlan(tx, dealId, oldTour.id);
        }
        await cancelDealBooking(tx, booking, { reason: 'activity_type_converted', origin });
        seatsReleased = true;
      }

      // The classification must land BEFORE the tour is created: the creator
      // reads deal.activityType to decide the TourEvent's kind and which branch
      // to take.
      const updated = await tx.deal.update({
        where: { id: dealId },
        data: dealPatch(classification, { opId, removingOrg }),
        select: CONVERSION_DEAL_SELECT,
      });

      const created = await createTourForWonDeal(tx, { ...updated, orderNo: deal.orderNo }, {
        targetTourEventId: tourEventId,
        origin,
        allowOverbook,
      });
      newTour = created.tourEvent;
      seatsAllocated = true;
      if (created.dealSync) {
        // A group slot owns its scheduling — sync it onto the deal in the same
        // transaction, the same way the WON path does.
        await tx.deal.update({ where: { id: dealId }, data: created.dealSync });
      }
    }

    // ── §11: nothing may send with the old operational state ────────────────
    const deliveryIds = oldTour && newTour && oldTour.id !== newTour.id
      ? await parkDealTourDeliveries(tx, {
          dealId, fromTourEventId: oldTour.id, toTourEventId: newTour.id,
        })
      : [];

    const after = {
      activityType: to,
      tourEventId: newTour?.id || null,
      tourKind: newTour?.kind || null,
      date: newTour?.date || null,
      startTime: newTour?.startTime || null,
      organizationId: resultingOrgId,
    };

    // ── §14: ONE immutable, readable audit event ────────────────────────────
    // Deliberately its own timeline entry with its own body, not a line inside
    // a generic field-change group: a conversion is the single most consequential
    // thing that can happen to a deal short of WON, and it must be findable.
    await emitTimelineEvent(tx, {
      subjectType: 'deal',
      subjectId: dealId,
      kind: 'tour',
      body: conversionBodyHe({ from, to, before, after, seatsReleased, seatsAllocated, removingOrg }),
      data: {
        event: 'activity_type_converted',
        opId, mode, from, to, before, after,
        seatsReleased, seatsAllocated,
        planPreserved,
        organizationRemoved: removingOrg,
        pendingMessagesReconciled: deliveryIds.length,
        actorUserId,
      },
      origin,
    });
    if (newTour) {
      await emitTimelineEvent(tx, {
        subjectType: 'tour_event',
        subjectId: newTour.id,
        kind: 'tour',
        data: { event: 'activity_type_converted', dealId, dealOrderNo: deal.orderNo, from, to, mode },
        origin,
      });
    }

    return {
      alreadyDone: false, mode, from, to, opId,
      oldTourEventId: oldTour?.id || null,
      newTourEventId: newTour?.id || null,
      deliveryIds,
      seatsReleased, seatsAllocated,
      organizationRemoved: removingOrg,
    };
  });

  return { dealId, ...out };
}

// The deal-side patch every mode applies. Converting IS an operator answering
// the classification question, so a pending system assumption dies here.
//
// The organization is written ONLY when the operator explicitly asked to remove
// it; otherwise the field is absent from the patch entirely and the link is
// untouched. Removing also clears the unit — a unit belongs to an organization,
// and the deals route enforces exactly that rule on every ordinary save.
function dealPatch(classification, { opId, removingOrg }) {
  return {
    activityType: classification.activityType,
    organizationTypeId: classification.organizationTypeId,
    organizationSubtypeId: classification.organizationSubtypeId,
    ...(removingOrg ? { organizationId: null, organizationUnitId: null } : {}),
    activityTypeAssumedAt: null,
    conversionOpId: opId,
  };
}

function fmt(date, startTime) {
  if (!date) return 'ללא מועד';
  const [y, m, d] = String(date).split('-');
  return `${d}.${m}.${y}${startTime ? ' ' + startTime : ''}`;
}

function conversionBodyHe({ from, to, before, after, seatsReleased, seatsAllocated, removingOrg }) {
  const fromLabel = from ? ACTIVITY_TYPE_LABELS_HE[from] : 'ללא סוג פעילות';
  const parts = [`🔄 סוג הפעילות שונה מ-${fromLabel} ל-${ACTIVITY_TYPE_LABELS_HE[to]}`];
  if (before.tourEventId && after.tourEventId && before.tourEventId !== after.tourEventId) {
    parts.push(`הסיור הוחלף: ${fmt(before.date, before.startTime)} ← ${fmt(after.date, after.startTime)}`);
  } else if (before.tourEventId) {
    parts.push(`הסיור נשמר ללא שינוי (${fmt(after.date, after.startTime)})`);
  }
  if (seatsReleased) parts.push('המקומות בסיור הקודם שוחררו');
  if (seatsAllocated) parts.push('נתפסו מקומות בסיור החדש');
  if (removingOrg) parts.push('הארגון הוסר מהדיל');
  parts.push('התשלומים והמסמכים החשבונאיים נשמרו');
  return parts.join(' · ');
}

// ── POST-COMMIT ─────────────────────────────────────────────────────────────

/**
 * The external effects, after the DB truth is already committed.
 *
 * Each one is isolated and idempotent: a failure here must NEVER be treated as
 * a failed conversion — the customer's conversion really happened — so nothing
 * throws, every outcome is reported, and the caller raises a recovery card when
 * anything came back false. Re-running is always safe.
 */
export async function runConversionEffects(
  { dealId, oldTourEventId, newTourEventId, deliveryIds = [] },
  { db = defaultPrisma, log = console } = {},
) {
  const results = { calendar: false, woo: false, payroll: false, deliveries: null };

  try {
    // Both tours were marked dirty inside the transaction by the canonical
    // writers; these only wake the reconcilers.
    kickTourCalendarSync();
    results.calendar = true;
  } catch (e) {
    log.error(`[conversion] calendar kick failed: ${e?.message || e}`);
  }
  try {
    kickWooSync();
    results.woo = true;
  } catch (e) {
    log.error(`[conversion] woo kick failed: ${e?.message || e}`);
  }
  try {
    // Draft payroll is a projection of the tour — both sides need recomputing:
    // the released tour may have lost its only booking, the new one has just
    // appeared.
    if (oldTourEventId) kickPayrollReconcile('tour', oldTourEventId);
    if (newTourEventId && newTourEventId !== oldTourEventId) kickPayrollReconcile('tour', newTourEventId);
    results.payroll = true;
  } catch (e) {
    log.error(`[conversion] payroll reconcile failed: ${e?.message || e}`);
  }
  // Never throws by contract.
  results.deliveries = await finalizeDealTourDeliveries({ deliveryIds, dealId }, { db, log });

  results.ok = results.calendar && results.woo && results.payroll && results.deliveries.failed === 0;
  return results;
}
