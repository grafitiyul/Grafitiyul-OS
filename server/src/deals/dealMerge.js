// ── THE canonical Deal merge ("איחוד דילים") ────────────────────────────────
//
// Two deals turn out to be ONE real transaction: two contacts opened separate
// deals, or the same customer was entered twice, or one deal carries the
// commercial work and the other carries the payment and the history. They must
// become one deal without losing anything either of them knows.
//
// ── The two rules everything else follows from ──────────────────────────────
//
//   1. NOTHING is written until the operator confirms. previewMerge() is a pure
//      read and stays one, so closing the wizard half-way leaves both deals
//      byte-identical. There is no draft merge, no partial contact link, no
//      temporary mutation.
//
//   2. The retired deal is RETIRED, never deleted. Every financial table
//      (IcountDocument, DealCollectionEvidence, PaymentRequest, QuoteVersion,
//      QuoteDocument) cascades from Deal, so `DELETE` would silently destroy
//      issued tax documents — deleteGuard.js already refuses that, and this
//      honours the same invariant. The row survives with mergedIntoDealId set:
//      its orderNo is never reused, its URL serves a tombstone, and its history
//      and money stay attributable to it forever.
//
// ── This module ORCHESTRATES; it does not reimplement ───────────────────────
//
// Everything dangerous a merge does already has a canonical owner, and the
// value here is sequencing them correctly and atomically:
//
//   cancelDealBooking      release a booking + its seats, auto-cancel an
//                          emptied dedicated tour, gallery cleanup
//   syncDealRegistration   the seat SSOT (re-converged after a re-parent)
//   transitionDealToWon    the ONE non-WON→WON writer
//   normalizeClassification the organization rule
//   computeCollection      the money picture (evidence is NEVER moved)
//   createReviewItem       an unmade business decision becomes a card
//   occupancyFor           the seat arithmetic
//
// The genuinely new pieces are the lineage record, the field resolution table
// (mergeResolve.js), and the operational decision matrix below.
//
// ── What a merge NEVER does ─────────────────────────────────────────────────
//
// Issue a refund, a credit note, an invoice or a receipt. Move or delete a
// single financial row. Duplicate an EmailMessage, a WhatsApp message or a
// TimelineEntry. Rewrite a note's author or timestamp. Merge Contact records.
// Cancel a tour the operator did not explicitly choose to cancel.

import { prisma as defaultPrisma } from '../db.js';
import { emitTimelineEvent } from '../timeline/events.js';
import { activeBookingFor, cancelDealBooking, copyTourStateToPlan } from '../tours/tourFromDeal.js';
import { syncDealRegistration } from '../tours/registrations.js';
import { occupancyFor } from '../tours/occupancy.js';
import { CAPACITY_STATUSES } from '../tours/registrationStatus.js';
import { kickTourCalendarSync } from '../tours/calendar/service.js';
import { kickWooSync } from '../tours/woo/service.js';
import { kickPayrollReconcile } from '../payroll/service.js';
import { transitionDealToWon, emitWonTransitionEffects } from './wonTransition.js';
import { normalizeClassification } from './classification.js';
import { computeCollection } from '../collection.js';
import { computePayableMinor } from './waiver.js';
import { createReviewItem } from '../reviewItems/service.js';
import { emitTasksChanged } from '../tasks/events.js';
import { dealMergeOverpaymentKey, DEAL_MERGE_OVERPAYMENT_KIND } from '../reviewItems/kinds/dealMergeOverpayment.js';
import { composeBuilderLines } from '../pricing/builderCompose.js';
import { resolveBuilderVatMode } from '../../../shared/vatMode.mjs';
import { resolveFieldLabels } from './mergeFieldLabels.js';
import { ACTIVITY_TYPE_LABELS_HE } from '../../../shared/dealActivity.mjs';
import { tourLanguageLabel, commLanguageLabel } from '../../../shared/language.mjs';
import {
  MERGE_FIELDS,
  resolveFields,
  resolveParticipants,
  resolveStatus,
  commercialSituation,
  composeMergedLines,
  buildCombineCandidates,
  resolveContacts,
  suggestTaskActions,
  resolveTaskAction,
} from './mergeResolve.js';

/** Thrown for every refusal. `code` is what the route turns into an error body. */
export class MergeError extends Error {
  constructor(code, details = null) {
    super(code);
    this.code = code;
    this.details = details;
  }
}

const coded = (code, details) => new MergeError(code, details);

/** The deal fields merge reads. Exported for the Prisma-shape contract test. */
export const MERGE_DEAL_SELECT = Object.freeze({
  id: true, orderNo: true, title: true, status: true, dealStageId: true,
  valueMinor: true, currency: true, discountMinor: true, noPaymentWaiver: true,
  participants: true, groups: true, durationHours: true,
  organizationId: true, organizationUnitId: true, organizationSubtypeId: true, organizationTypeId: true,
  activityType: true, activityTypeAssumedAt: true,
  productId: true, productVariantId: true, locationId: true,
  tourDate: true, tourTime: true, tourLanguage: true, communicationLanguage: true,
  paymentTermId: true, paymentMethodId: true, dealSourceId: true, source: true,
  ownerUserId: true, expectedCloseDate: true, groupName: true, notes: true, customerInfo: true,
  collectionReview: true, mergedIntoDealId: true, mergedAt: true, mergeOpId: true,
  createdAt: true, updatedAt: true, lastMeaningfulActivityAt: true,
});

const LINE_SELECT = {
  id: true, kind: true, label: true, productVariantId: true, addonId: true,
  quantity: true, unitPriceMinor: true, discountPercent: true, discountFixedMinor: true,
  vatMode: true, vatRate: true, active: true, note: true, overridden: true,
  sourceKind: true, sourceCardGroupId: true, pinnedCardGroupId: true, ticketTypeId: true,
  sortOrder: true,
};

// ── Loading one side of the merge ───────────────────────────────────────────

async function loadSide(client, dealId) {
  const deal = await client.deal.findUnique({ where: { id: dealId }, select: MERGE_DEAL_SELECT });
  if (!deal) throw coded('not_found', { dealId });

  // Display labels for the comparison screen. A separate query rather than
  // nested selects inside MERGE_DEAL_SELECT, which the Prisma-shape contract
  // test asserts is scalar-only.
  const labelRow = await client.deal.findUnique({
    where: { id: dealId },
    select: {
      organization: { select: { id: true, name: true } },
      organizationUnit: { select: { name: true } },
      product: { select: { nameHe: true, nameEn: true } },
      productVariant: { select: { location: { select: { nameHe: true } } } },
      dealStage: { select: { label: true } },
      dealSource: { select: { label: true } },
    },
  });

  const [contacts, workingVersion, booking, registrations, tasks, notesCount, documents, evidence] =
    await Promise.all([
      client.dealContact.findMany({
        where: { dealId },
        select: {
          id: true, contactId: true, roles: true, isPrimary: true,
          receiveConfirmations: true, receiveOperationalUpdates: true,
          receivePaymentLinks: true, receiveQuotes: true,
          contact: {
            select: {
              id: true, firstNameHe: true, lastNameHe: true, firstNameEn: true, lastNameEn: true,
              phones: { select: { value: true, isPrimary: true } },
              emails: { select: { value: true, isPrimary: true } },
            },
          },
        },
      }),
      client.quoteVersion.findFirst({
        where: { dealId, isWorking: true },
        select: {
          id: true, vatMode: true, dealDiscountPercent: true, dealDiscountFixedMinor: true,
          offerId: true, lines: { select: LINE_SELECT, orderBy: { sortOrder: 'asc' } },
        },
      }),
      activeBookingFor(client, dealId),
      client.ticketRegistration.findMany({
        where: { dealId, status: { in: CAPACITY_STATUSES } },
        select: { id: true, tourEventId: true, quantity: true, status: true, bookingId: true, source: true },
      }),
      client.task.findMany({
        where: { dealId, status: 'open' },
        select: { id: true, title: true, dueDate: true, dueTime: true, taskTypeId: true, ownerUserId: true, createdAt: true },
        orderBy: { dueDate: 'asc' },
      }),
      client.timelineEntry.count({ where: { subjectType: 'deal', subjectId: dealId, deletedAt: null } }),
      client.icountDocument.findMany({ where: { dealId, status: 'issued' } }),
      client.dealCollectionEvidence.findMany({ where: { dealId, status: 'active' } }),
    ]);

  const money = computeCollection(deal, documents, evidence);
  return {
    deal,
    contacts,
    workingVersion,
    lines: workingVersion?.lines || [],
    booking,
    tourEvent: booking?.tourEvent || null,
    registrations,
    tasks,
    notesCount,
    money,
    labels: {
      organizationName: labelRow?.organization?.name || null,
      unitName: labelRow?.organizationUnit?.name || null,
      productName: labelRow?.product?.nameHe || labelRow?.product?.nameEn || null,
      variantName: labelRow?.productVariant?.location?.nameHe || null,
      stageLabel: labelRow?.dealStage?.label || null,
      sourceLabel: labelRow?.dealSource?.label || null,
    },
  };
}

// ── The operational matrix ──────────────────────────────────────────────────
//
// A merge must never leave two live operational truths behind. Which decision
// is available depends entirely on where the two deals actually sit, and the
// options are deliberately narrow — every one of them delegates to a canonical
// service rather than touching a booking directly.

export const OPERATIONAL_MODES = Object.freeze([
  'none',              // neither side is live — nothing to do
  'keep_survivor',     // only the survivor is live — untouched
  'adopt_other',       // only the retired deal is live — its booking moves over
  'keep_survivor_tour', // both live — survivor's tour wins, the other is released
  'adopt_other_tour',  // both live — the other's tour wins, survivor's is released
  'merge_seats',       // both live on the SAME tour — seats combine on one booking
]);

/**
 * What operational decision does this pair require, and which options are real?
 *
 * Pure given the two loaded sides, so the preview and the confirm transaction
 * reach the same verdict from the same inputs.
 */
export function operationalSituation(survivorSide, otherSide, choice = null) {
  const aLive = !!survivorSide.booking;
  const bLive = !!otherSide.booking;

  if (!aLive && !bLive) return { situation: 'none', mode: 'none', needsChoice: false, options: [] };
  if (aLive && !bLive) return { situation: 'survivor_only', mode: 'keep_survivor', needsChoice: false, options: [] };
  if (!aLive && bLive) return { situation: 'other_only', mode: 'adopt_other', needsChoice: false, options: [] };

  const sameTour = survivorSide.tourEvent?.id === otherSide.tourEvent?.id;
  const options = sameTour
    ? ['merge_seats', 'keep_survivor_tour']
    : ['keep_survivor_tour', 'adopt_other_tour'];
  return {
    situation: sameTour ? 'both_live_same_tour' : 'both_live_different_tours',
    sameTour,
    mode: options.includes(choice) ? choice : null,
    needsChoice: !options.includes(choice),
    options,
  };
}

// The seat arithmetic, isolated so PREVIEW and CONFIRM share one copy. The
// deal's own held seats already count in occupancy, so they are subtracted —
// otherwise a legitimate merge is refused for seats it already holds.
async function slotCapacityCheck(client, { tourEvent, dealIds, seats }) {
  if (!tourEvent || tourEvent.capacity == null) {
    return { tourEventId: tourEvent?.id || null, capacity: null, activeSeats: null, requested: seats, fits: true };
  }
  const occ = await occupancyFor(client, [tourEvent.id]);
  let current = occ[tourEvent.id]?.activeSeats || 0;
  const own = await client.ticketRegistration.aggregate({
    where: { dealId: { in: dealIds }, tourEventId: tourEvent.id, status: { in: CAPACITY_STATUSES } },
    _sum: { quantity: true },
  });
  current -= own._sum.quantity || 0;
  return {
    tourEventId: tourEvent.id,
    capacity: tourEvent.capacity,
    activeSeats: current,
    requested: seats,
    fits: current + seats <= tourEvent.capacity,
  };
}

/**
 * The survivor's PAYABLE total after a builder change.
 *
 * A deal registered without payment carries a canonical no-payment waiver: the
 * Builder stays fully commercial (real prices on real lines) and
 * Deal.valueMinor is gross − waived. A merge that replaces or recomposes the
 * Builder must re-apply that subtraction, or it would silently bill a customer
 * who was explicitly waived — the waiver would still be on the deal, saying one
 * thing, while valueMinor said another.
 *
 * The waiver itself never travels FROM the retired deal (NEVER_MERGED): it is a
 * decision about THAT deal's money. Only the survivor's own waiver applies.
 */
export function payableAfterMerge(grossMinor, waiver, mergedLines) {
  if (!waiver) return grossMinor;
  const groupLines = (mergedLines || [])
    .filter((l) => l.sourceKind === 'group_ticket' && l.active !== false)
    .map((l) => ({
      cardGroupId: l.sourceCardGroupId || null,
      ticketTypeId: l.ticketTypeId || null,
      quantity: l.quantity || 0,
      unitPriceMinor: Number(l.unitPriceMinor) || 0,
    }));
  return computePayableMinor(grossMinor, waiver, groupLines);
}

// ── The merged commercial total ─────────────────────────────────────────────
//
// Computed with the CANONICAL composition (builderCompose), never a hand-rolled
// sum: VAT mode decides whether a typed amount is net or gross, and a merge that
// added numbers itself would produce a total the Builder disagrees with the
// moment it is reopened.
//
// productResolution is deliberately `{ ok: false }`: every line in a merged set
// carries its own stored unit price (already engine-resolved at ITS deal's last
// save), and re-running the engine here would silently re-price the customer's
// agreed line against today's catalog.
export function computeMergedTotal({ lines, vatMode, priceListDefault, vatRate, dealDiscount }) {
  const { totals } = composeBuilderLines({
    inputLines: lines,
    productResolution: { ok: false, error: 'merge_frozen' },
    vatDefault: {
      mode: resolveBuilderVatMode(vatMode, priceListDefault),
      rate: vatRate != null ? vatRate : 18,
    },
    dealDiscount: dealDiscount || null,
  });
  return totals;
}

// The platform VAT fallback for an order that never chose a mode — the system
// default price list, exactly as the Builder route resolves it.
async function priceListDefaults(client) {
  const pl =
    (await client.priceList.findFirst({
      where: { isDefault: true, active: true },
      select: { defaultVatMode: true, defaultVatRate: true },
    }))
    || (await client.priceList.findFirst({
      where: { active: true },
      select: { defaultVatMode: true, defaultVatRate: true },
      orderBy: { sortOrder: 'asc' },
    }));
  return { mode: pl?.defaultVatMode || null, rate: pl?.defaultVatRate != null ? pl.defaultVatRate : 18 };
}

// ── PREVIEW ─────────────────────────────────────────────────────────────────

/**
 * Everything the operator must see before committing. PURE READ — this function
 * writes nothing, ever, and its verdict is advice: every blocker it reports is
 * re-evaluated inside the confirm transaction, which is the only authority.
 */
export async function previewMerge(client, { dealAId, dealBId, decisions = {} }) {
  if (!dealAId || !dealBId) throw coded('two_deals_required');
  if (dealAId === dealBId) throw coded('same_deal');

  const survivorId = decisions.survivorDealId || dealAId;
  if (survivorId !== dealAId && survivorId !== dealBId) throw coded('invalid_survivor');
  const retiredId = survivorId === dealAId ? dealBId : dealAId;

  const [survivorSide, otherSide] = await Promise.all([
    loadSide(client, survivorId),
    loadSide(client, retiredId),
  ]);

  const blockers = [];
  const warnings = [];

  // A deal already retired by an earlier merge is history, not a party to a new
  // one. Merging INTO it would resurrect it; merging it away again is refused by
  // the unique index anyway.
  if (survivorSide.deal.mergedIntoDealId) blockers.push({ code: 'survivor_already_retired' });
  if (otherSide.deal.mergedIntoDealId) blockers.push({ code: 'other_already_retired' });

  // ── field resolution ──────────────────────────────────────────────────────
  const fieldChoices = decisions.fields || {};
  const fields = resolveFields(survivorSide.deal, otherSide.deal, fieldChoices);

  // What each side's value ACTUALLY IS, in business language. Resolved here so
  // the client never receives an id it would have to describe as "ערך אחר" —
  // the operator must be able to answer "which value survives?" from the
  // wizard alone, without opening either deal.
  const fieldLabels = await resolveFieldLabels(client, fields.fields, survivorSide.deal, otherSide.deal);
  const withLabels = (f) => ({
    ...f,
    survivorDisplay: fieldLabels.get(f.key)?.survivor || null,
    otherDisplay: fieldLabels.get(f.key)?.other || null,
  });

  // ── participants ──────────────────────────────────────────────────────────
  const participants = resolveParticipants(
    survivorSide.deal.participants,
    otherSide.deal.participants,
    decisions.participants,
    decisions.participantsCustom,
  );

  // ── status ────────────────────────────────────────────────────────────────
  const status = resolveStatus(survivorSide.deal.status, otherSide.deal.status, decisions.status);

  // ── commercial ────────────────────────────────────────────────────────────
  const commercial = commercialSituation(
    { valueMinor: survivorSide.deal.valueMinor, lines: survivorSide.lines },
    { valueMinor: otherSide.deal.valueMinor, lines: otherSide.lines },
    decisions.commercial,
  );
  const combineCandidates = buildCombineCandidates(survivorSide.lines, otherSide.lines);
  const keepLineIds = Array.isArray(decisions.commercialLineIds) && decisions.commercialLineIds.length
    ? decisions.commercialLineIds
    : combineCandidates.filter((c) => c.defaultSelected).map((c) => c.id);

  const defaults = await priceListDefaults(client);
  let mergedLines = [];
  let mergedTotalMinor = Number(survivorSide.deal.valueMinor || 0);
  let mergedVatMode = survivorSide.workingVersion?.vatMode || null;
  let dealDiscount = null;
  if (commercial.resolution) {
    const sourceVersion = commercial.resolution === 'other'
      ? otherSide.workingVersion
      : survivorSide.workingVersion;
    mergedVatMode = sourceVersion?.vatMode || null;
    dealDiscount = sourceVersion?.dealDiscountPercent
      ? { percent: Number(sourceVersion.dealDiscountPercent) }
      : sourceVersion?.dealDiscountFixedMinor
        ? { fixedMinor: Number(sourceVersion.dealDiscountFixedMinor) }
        : null;
    mergedLines = composeMergedLines({
      resolution: commercial.resolution,
      survivorLines: survivorSide.lines,
      otherLines: otherSide.lines,
      keepLineIds,
    });
    if (mergedLines.length) {
      const totals = computeMergedTotal({
        lines: mergedLines,
        vatMode: mergedVatMode,
        priceListDefault: defaults.mode,
        vatRate: defaults.rate,
        dealDiscount,
      });
      // gross → PAYABLE: the survivor's no-payment waiver still applies to the
      // recomposed Builder, exactly as it does to every ordinary Builder save.
      mergedTotalMinor = payableAfterMerge(
        totals.grossMinor,
        survivorSide.deal.noPaymentWaiver,
        mergedLines,
      );
    } else {
      // No lines chosen: the headline total of the chosen side stands, so a
      // deal whose value predates the Builder (a migrated headline) is not
      // silently zeroed.
      mergedTotalMinor = Number(
        (commercial.resolution === 'other' ? otherSide.deal.valueMinor : survivorSide.deal.valueMinor) || 0,
      );
    }
  }

  // ── contacts ──────────────────────────────────────────────────────────────
  const contacts = resolveContacts(
    survivorSide.contacts,
    otherSide.contacts,
    decisions.primaryContactId,
  );

  // ── operational ───────────────────────────────────────────────────────────
  const operational = operationalSituation(survivorSide, otherSide, decisions.operational);
  let capacity = null;
  if (operational.mode === 'merge_seats') {
    const seats = participants.value ?? ((survivorSide.booking?.seats || 0) + (otherSide.booking?.seats || 0));
    capacity = await slotCapacityCheck(client, {
      tourEvent: survivorSide.tourEvent,
      dealIds: [survivorId, retiredId],
      seats,
    });
    if (!capacity.fits && !decisions.allowOverbook) blockers.push({ code: 'tour_full', ...capacity });
  }
  if (operational.mode === 'adopt_other' || operational.mode === 'adopt_other_tour') {
    const seats = participants.value ?? otherSide.booking?.seats ?? 0;
    capacity = await slotCapacityCheck(client, {
      tourEvent: otherSide.tourEvent,
      dealIds: [survivorId, retiredId],
      seats,
    });
    if (!capacity.fits && !decisions.allowOverbook) blockers.push({ code: 'tour_full', ...capacity });
  }

  // ── what still needs an answer ────────────────────────────────────────────
  if (commercial.needsChoice) blockers.push({ code: 'commercial_choice_required' });
  if (participants.needsChoice) blockers.push({ code: 'participants_choice_required' });
  if (operational.needsChoice) {
    blockers.push({
      code: 'operational_choice_required',
      options: operational.options,
      sameTour: !!operational.sameTour,
    });
  }
  if (fields.unanswered.length) {
    blockers.push({
      code: 'field_choice_required',
      fields: fields.unanswered.map((f) => ({ key: f.key, labelHe: f.labelHe })),
    });
  }

  // ── money (never mutated — only reported) ─────────────────────────────────
  // The merged picture: BOTH sides' evidence against the chosen total. Nothing
  // is moved to produce this — the survivor's collection becomes lineage-aware
  // the moment the merge commits, and this is the same arithmetic in advance.
  const combinedPaidMinor = survivorSide.money.paidMinor + otherSide.money.paidMinor;
  const mergedBalanceMinor = mergedTotalMinor - combinedPaidMinor;
  if (mergedBalanceMinor < 0) {
    warnings.push({
      code: 'merge_overpayment',
      amountMinor: Math.abs(mergedBalanceMinor),
      messageHe:
        'הסכום ששולם בשני הדילים גבוה מהסכום המשולב. לא יופק זיכוי ולא יבוצע החזר אוטומטית — '
        + 'תיפתח משימת טיפול לקבלת החלטה לפי כללי החשבונאות.',
    });
  }
  if (survivorSide.money.currency !== otherSide.money.currency) {
    blockers.push({
      code: 'currency_mismatch',
      currencies: [survivorSide.money.currency, otherSide.money.currency],
    });
  }

  // ── consequences the operator has a right to know ─────────────────────────
  if (status.triggersWonTransition) {
    warnings.push({
      code: 'won_transition',
      messageHe: 'הדיל המאוחד ייסגר כ-WON. הודעות וטריגרים של סגירת דיל יופעלו פעם אחת בלבד.',
    });
  }
  if (status.value === 'won' && operational.mode === 'none') {
    warnings.push({
      code: 'won_without_tour',
      messageHe: 'הדיל המאוחד יהיה WON ללא סיור משובץ — יופיע באזור "השלמת פרטי סיור" עד שייווצר סיור.',
    });
  }
  if (operational.mode === 'keep_survivor_tour' && otherSide.tourEvent) {
    warnings.push({
      code: 'other_tour_released',
      messageHe: otherSide.tourEvent.kind === 'group_slot'
        ? 'המקומות של הדיל השני בסיור הקבוצתי ישוחררו. הסיור עצמו ממשיך כרגיל.'
        : 'הסיור הייעודי של הדיל השני ישוחרר ויבוטל אם לא נותרו בו הזמנות. צוות, רכיבים והערות יישמרו בתכנון הדיל.',
    });
  }
  if (operational.mode === 'adopt_other_tour' && survivorSide.tourEvent) {
    warnings.push({
      code: 'survivor_tour_released',
      messageHe: survivorSide.tourEvent.kind === 'group_slot'
        ? 'המקומות של הדיל השורד בסיור הנוכחי ישוחררו, והוא ישובץ לסיור של הדיל השני.'
        : 'הסיור הייעודי הנוכחי של הדיל השורד ישוחרר ויבוטל אם לא נותרו בו הזמנות.',
    });
  }
  if (contacts.primaryConflict) {
    warnings.push({
      code: 'primary_contact_differs',
      messageHe: 'לשני הדילים אנשי קשר ראשיים שונים. איש הקשר הראשי של הדיל השורד נשאר ראשי — ניתן לשנות לפני האישור.',
    });
  }
  if (otherSide.money.evidence.length) {
    warnings.push({
      code: 'financial_history_preserved',
      count: otherSide.money.evidence.length,
      messageHe: `${otherSide.money.evidence.length} רשומות חשבונאיות של הדיל השני יישארו רשומות עליו לצורכי ביקורת, ויוצגו בדיל המאוחד.`,
    });
  }

  return {
    survivorDealId: survivorId,
    retiredDealId: retiredId,
    survivor: sideDto(survivorSide),
    other: sideDto(otherSide),
    fields: fields.fields.map(withLabels),
    fieldConflicts: fields.conflicts.map(withLabels),
    autoResolvedFields: fields.autoResolved.map(withLabels),
    participants,
    status,
    commercial: {
      ...commercial,
      candidates: combineCandidates,
      selectedLineIds: keepLineIds,
      mergedTotalMinor,
      mergedLineCount: mergedLines.length,
      demotedProductLines: mergedLines.filter((l) => l._demoted).length,
    },
    contacts: {
      links: contacts.links,
      primaryContactId: contacts.primaryContactId,
      addedCount: contacts.added.length,
      primaryConflict: contacts.primaryConflict,
      // Identity for the primary picker. Two people on two deals often share a
      // name — that is frequently WHY the deals are being merged — so a name
      // alone cannot answer "which of these is the primary contact?". Phones,
      // emails, the linked organization and which deal each came from are
      // resolved once here, on the server, for the same reason the field labels
      // are: the operator must decide from the wizard alone.
      people: await buildContactIdentities(client, survivorSide, otherSide),
    },
    operational: {
      ...operational,
      survivorTour: tourDto(survivorSide),
      otherTour: tourDto(otherSide),
      capacity,
    },
    tasks: {
      survivor: survivorSide.tasks,
      other: otherSide.tasks,
      // Per-task DEFAULT: move real work, close a duplicate the system itself
      // says there should only be one of (see suggestTaskActions).
      suggestions: suggestTaskActions(survivorSide.tasks, otherSide.tasks),
    },
    money: {
      survivor: moneyDto(survivorSide.money),
      other: moneyDto(otherSide.money),
      combinedPaidMinor,
      mergedTotalMinor,
      mergedBalanceMinor,
      currency: survivorSide.money.currency,
      overpaidMinor: mergedBalanceMinor < 0 ? Math.abs(mergedBalanceMinor) : 0,
    },
    plan: buildPlanSteps({
      survivorSide, otherSide, fields, participants, status, commercial,
      contacts, operational, mergedTotalMinor, mergedBalanceMinor,
    }),
    warnings,
    blockers,
    canMerge: blockers.length === 0,
  };
}

function contactDisplayName(c) {
  if (!c) return 'איש קשר';
  const he = `${c.firstNameHe || ''} ${c.lastNameHe || ''}`.trim();
  return he || `${c.firstNameEn || ''} ${c.lastNameEn || ''}`.trim() || 'איש קשר';
}

// Primary value first, then the rest — the order an operator reads them in.
function orderedValues(list) {
  const arr = list || [];
  const primary = arr.filter((x) => x.isPrimary).map((x) => x.value);
  const rest = arr.filter((x) => !x.isPrimary).map((x) => x.value);
  return [...primary, ...rest].filter(Boolean);
}

/**
 * The identity card for every contact on either deal.
 *
 * Contact↔Organization is its own link table (a contact can belong to several
 * organizations), so it is loaded in ONE batched query for all of them rather
 * than per contact.
 */
async function buildContactIdentities(client, survivorSide, otherSide) {
  const links = [
    ...survivorSide.contacts.map((l) => ({ link: l, from: 'survivor', orderNo: survivorSide.deal.orderNo })),
    ...otherSide.contacts.map((l) => ({ link: l, from: 'other', orderNo: otherSide.deal.orderNo })),
  ];
  const contactIds = [...new Set(links.map((x) => x.link.contactId))];
  if (!contactIds.length) return [];

  const orgLinks = contactIds.length
    ? await client.contactOrganization.findMany({
      where: { contactId: { in: contactIds } },
      select: { contactId: true, organization: { select: { name: true } } },
    })
    : [];
  const orgsByContact = new Map();
  for (const ol of orgLinks) {
    if (!ol.organization?.name) continue;
    if (!orgsByContact.has(ol.contactId)) orgsByContact.set(ol.contactId, []);
    orgsByContact.get(ol.contactId).push(ol.organization.name);
  }

  const byContact = new Map();
  for (const { link, from, orderNo } of links) {
    const existing = byContact.get(link.contactId);
    if (existing) {
      // The same person on BOTH deals — say so; it is the clearest signal that
      // these really are one transaction.
      if (!existing.onDeals.includes(orderNo)) existing.onDeals.push(orderNo);
      existing.wasPrimaryOn.push(...(link.isPrimary ? [orderNo] : []));
      continue;
    }
    const c = link.contact;
    byContact.set(link.contactId, {
      contactId: link.contactId,
      name: contactDisplayName(c),
      phones: orderedValues(c?.phones),
      emails: orderedValues(c?.emails),
      organizations: orgsByContact.get(link.contactId) || [],
      roles: link.roles || [],
      onDeals: [orderNo],
      wasPrimaryOn: link.isPrimary ? [orderNo] : [],
      from,
    });
  }
  return [...byContact.values()];
}

function sideDto(side) {
  const primary = side.contacts.find((c) => c.isPrimary) || side.contacts[0] || null;
  return {
    id: side.deal.id,
    orderNo: side.deal.orderNo,
    title: side.deal.title,
    status: side.deal.status,
    valueMinor: Number(side.deal.valueMinor || 0),
    currency: side.deal.currency,
    participants: side.deal.participants,
    activityType: side.deal.activityType,
    tourDate: side.deal.tourDate,
    tourTime: side.deal.tourTime,
    tourLanguage: side.deal.tourLanguage,
    createdAt: side.deal.createdAt,
    updatedAt: side.deal.updatedAt,
    lastActivityAt: side.deal.lastMeaningfulActivityAt,
    organizationName: side.labels.organizationName,
    unitName: side.labels.unitName,
    productName: side.labels.productName,
    variantName: side.labels.variantName,
    stageLabel: side.labels.stageLabel,
    // Business language, never the stored enum/id — the comparison screen is
    // where the operator first reads these values.
    sourceLabel: side.labels.sourceLabel,
    sourceDetail: side.deal.source || null,
    activityTypeLabel: side.deal.activityType ? ACTIVITY_TYPE_LABELS_HE[side.deal.activityType] || side.deal.activityType : null,
    tourLanguageLabel: tourLanguageLabel(side.deal.tourLanguage),
    communicationLanguageLabel: commLanguageLabel(side.deal.communicationLanguage),
    primaryContactName: primary ? contactDisplayName(primary.contact) : null,
    contactCount: side.contacts.length,
    notesCount: side.notesCount,
    openTaskCount: side.tasks.length,
    hasBuilder: side.lines.length > 0,
    builderLineCount: side.lines.length,
  };
}

function tourDto(side) {
  if (!side.tourEvent) return null;
  const t = side.tourEvent;
  return {
    id: t.id, kind: t.kind, status: t.status, date: t.date, startTime: t.startTime,
    capacity: t.capacity ?? null,
    bookingId: side.booking?.id || null,
    seats: side.booking?.seats ?? null,
    registrationSeats: side.registrations.reduce((s, r) => s + (Number(r.quantity) || 0), 0),
  };
}

function moneyDto(m) {
  return {
    totalMinor: m.totalMinor,
    paidMinor: m.paidMinor,
    balanceMinor: m.balanceMinor,
    status: m.status,
    currency: m.currency,
    documentCount: m.evidence.length,
  };
}

// Human-readable, ordered, in Hebrew — the operator reads exactly what will
// happen before it happens. Derived from the resolution, never hand-maintained
// per screen.
function buildPlanSteps({
  survivorSide, otherSide, fields, participants, status, commercial,
  contacts, operational, mergedTotalMinor, mergedBalanceMinor,
}) {
  const s = `#${survivorSide.deal.orderNo}`;
  const r = `#${otherSide.deal.orderNo}`;
  const steps = [];
  steps.push(`דיל ${s} יישאר הדיל הפעיל. דיל ${r} יסומן כמאוחד לתוכו ולא יופיע יותר כדיל עצמאי.`);

  if (contacts.added.length) {
    steps.push(`${contacts.added.length} אנשי קשר מדיל ${r} יתווספו לדיל ${s}. איש הקשר הראשי נשאר כפי שנבחר.`);
  } else {
    steps.push('אנשי הקשר זהים בשני הדילים — לא יתווספו קישורים חדשים.');
  }

  if (commercial.resolution === 'combine') {
    steps.push(`הבילדר של הדיל המאוחד יורכב מהשורות שנבחרו. סה"כ חדש: ${fmtMoney(mergedTotalMinor, survivorSide.deal.currency)}.`);
  } else if (commercial.resolution === 'other') {
    steps.push(`המחיר והבילדר של דיל ${r} יעברו לדיל ${s}. סה"כ: ${fmtMoney(mergedTotalMinor, survivorSide.deal.currency)}.`);
  } else if (commercial.situation === 'survivor_only' || commercial.resolution === 'survivor') {
    steps.push(`המחיר והבילדר של דיל ${s} נשמרים ללא שינוי (${fmtMoney(mergedTotalMinor, survivorSide.deal.currency)}).`);
  }

  if (participants.value != null) steps.push(`מספר המשתתפים בדיל המאוחד: ${participants.value}.`);

  const autoNames = fields.autoResolved.map((f) => f.labelHe);
  if (autoNames.length) steps.push(`שדות שהיו ריקים בדיל ${s} יתמלאו מדיל ${r}: ${autoNames.join(', ')}.`);
  const chosen = fields.conflicts.filter((f) => f.choice === 'other').map((f) => f.labelHe);
  if (chosen.length) steps.push(`שדות שנבחרו מדיל ${r}: ${chosen.join(', ')}.`);

  if (status.differs) {
    steps.push(`הסטטוס של הדיל המאוחד יהיה ${status.value.toUpperCase()} (${status.survivorStatus.toUpperCase()} + ${status.otherStatus.toUpperCase()}).`);
  }

  const when = (t) => (t?.date ? `${t.date}${t.startTime ? ' ' + t.startTime : ''}` : 'ללא מועד');
  if (operational.mode === 'adopt_other' || operational.mode === 'adopt_other_tour') {
    if (operational.mode === 'adopt_other_tour') {
      steps.push(`ההזמנה הנוכחית של דיל ${s} (${when(survivorSide.tourEvent)}) תבוטל והמקומות ישוחררו.`);
    }
    steps.push(`ההזמנה והמקומות של דיל ${r} (${when(otherSide.tourEvent)}) יועברו לדיל ${s} — ללא ביטול ויצירה מחדש, אותם מקומות ואותו סיור.`);
  }
  if (operational.mode === 'keep_survivor_tour') {
    steps.push(`הסיור של דיל ${s} (${when(survivorSide.tourEvent)}) נשמר. ההזמנה של דיל ${r} (${when(otherSide.tourEvent)}) תבוטל והמקומות ישוחררו.`);
  }
  if (operational.mode === 'merge_seats') {
    steps.push(`שני הדילים משובצים לאותו סיור (${when(survivorSide.tourEvent)}). ההזמנות יאוחדו להזמנה אחת בדיל ${s}.`);
  }
  if (operational.mode === 'keep_survivor') {
    steps.push(`הסיור וההזמנה של דיל ${s} נשמרים ללא שינוי.`);
  }

  steps.push(`כל התשלומים, המסמכים החשבונאיים והראיות של דיל ${r} נשמרים במלואם ונשארים רשומים עליו לצורכי ביקורת.`);
  steps.push(`ההיסטוריה של שני הדילים — הערות, מיילים, וואטסאפ, שינויים ואירועים — תוצג בדיל ${s} כציר זמן אחד לפי סדר כרונולוגי אמיתי.`);
  if (mergedBalanceMinor < 0) {
    steps.push('הסכום ששולם גבוה מהסכום המשולב — תיפתח משימת טיפול. לא יופק זיכוי ולא יבוצע החזר.');
  }
  steps.push(`חיפוש לפי מספר ${r} ימשיך לעבוד ויוביל לדיל ${s}.`);
  return steps;
}

function fmtMoney(minor, currency = 'ILS') {
  const n = (Number(minor) || 0) / 100;
  const sign = currency === 'ILS' ? '₪' : `${currency} `;
  return `${sign}${n.toLocaleString('he-IL', { maximumFractionDigits: 2 })}`;
}

// ── CONFIRM ─────────────────────────────────────────────────────────────────

/**
 * Perform the merge.
 *
 * One transaction for everything that must be atomic; every external effect is
 * post-commit and separately retryable. Refusals happen BEFORE the first write,
 * so a blocked merge leaves both deals byte-identical.
 *
 * `opId` is the idempotency identity: re-sending the same one returns the
 * previous outcome without doing anything again (guarded at the DB by the
 * unique index on Deal.mergeOpId AND DealMerge.opId, so two concurrent requests
 * cannot both win). Callers mint it once per operator intent, not per retry.
 */
export async function mergeDeals(
  { dealAId, dealBId, decisions = {}, opId, actorUserId = null, actorName = null, origin = null },
  { db = defaultPrisma } = {},
) {
  if (!opId) throw coded('merge_op_id_required');

  // Idempotency, cheap path: this exact operation already ran.
  const prior = await db.dealMerge.findUnique({
    where: { opId },
    select: { id: true, survivorDealId: true, retiredDealId: true, survivorOrderNo: true, retiredOrderNo: true, outcome: true },
  });
  if (prior) {
    return {
      alreadyDone: true,
      mergeId: prior.id,
      survivorDealId: prior.survivorDealId,
      retiredDealId: prior.retiredDealId,
      survivorOrderNo: prior.survivorOrderNo,
      retiredOrderNo: prior.retiredOrderNo,
      outcome: prior.outcome,
      wonTransition: null,
    };
  }

  const out = await db.$transaction(async (tx) => {
    // ── re-evaluate EVERYTHING here, where it is authoritative ──────────────
    const preview = await previewMerge(tx, { dealAId, dealBId, decisions });
    if (preview.blockers.length) {
      throw coded('merge_blocked', { blockers: preview.blockers });
    }

    const survivorId = preview.survivorDealId;
    const retiredId = preview.retiredDealId;
    const [survivorSide, otherSide] = await Promise.all([
      loadSide(tx, survivorId),
      loadSide(tx, retiredId),
    ]);

    const outcome = {
      contactsLinked: 0, contactsAlreadyPresent: 0,
      linesWritten: 0, productLinesDemoted: 0,
      bookingReparented: null, bookingCancelled: null, seatsMerged: null,
      registrationsMoved: 0, tasksMoved: 0, tasksClosed: 0,
      planPreserved: null, reviewCardId: null,
    };

    // ── 1. CONTACTS — union, exactly one primary ────────────────────────────
    const contacts = resolveContacts(survivorSide.contacts, otherSide.contacts, decisions.primaryContactId);
    for (const link of contacts.links) {
      const existing = survivorSide.contacts.find((c) => c.contactId === link.contactId);
      const data = {
        roles: link.roles,
        isPrimary: link.isPrimary,
        receiveConfirmations: link.receiveConfirmations,
        receiveOperationalUpdates: link.receiveOperationalUpdates,
        receivePaymentLinks: link.receivePaymentLinks,
        receiveQuotes: link.receiveQuotes,
      };
      if (existing) {
        await tx.dealContact.update({ where: { id: existing.id }, data });
        outcome.contactsAlreadyPresent += 1;
      } else {
        // The retired deal's own DealContact row stays where it is: it is the
        // record of who was on THAT deal, and the survivor gets its own link.
        await tx.dealContact.create({ data: { dealId: survivorId, contactId: link.contactId, ...data } });
        outcome.contactsLinked += 1;
      }
    }

    // ── 2. COMMERCIAL — one working Builder on the survivor ─────────────────
    const commercial = commercialSituation(
      { valueMinor: survivorSide.deal.valueMinor, lines: survivorSide.lines },
      { valueMinor: otherSide.deal.valueMinor, lines: otherSide.lines },
      decisions.commercial,
    );
    let mergedTotalMinor = Number(survivorSide.deal.valueMinor || 0);
    if (commercial.resolution && commercial.resolution !== 'survivor') {
      const keepLineIds = Array.isArray(decisions.commercialLineIds) && decisions.commercialLineIds.length
        ? decisions.commercialLineIds
        : buildCombineCandidates(survivorSide.lines, otherSide.lines)
          .filter((c) => c.defaultSelected).map((c) => c.id);
      const mergedLines = composeMergedLines({
        resolution: commercial.resolution,
        survivorLines: survivorSide.lines,
        otherLines: otherSide.lines,
        keepLineIds,
      });
      const sourceVersion = commercial.resolution === 'other' ? otherSide.workingVersion : survivorSide.workingVersion;
      const defaults = await priceListDefaults(tx);
      const dealDiscount = sourceVersion?.dealDiscountPercent
        ? { percent: Number(sourceVersion.dealDiscountPercent) }
        : sourceVersion?.dealDiscountFixedMinor
          ? { fixedMinor: Number(sourceVersion.dealDiscountFixedMinor) }
          : null;

      const version = await ensureSurvivorWorkingVersion(tx, survivorId, survivorSide.workingVersion);
      await tx.quoteVersion.update({
        where: { id: version.id },
        data: {
          vatMode: sourceVersion?.vatMode || null,
          dealDiscountPercent: sourceVersion?.dealDiscountPercent ?? null,
          dealDiscountFixedMinor: sourceVersion?.dealDiscountFixedMinor ?? null,
        },
      });
      // Replace-sync, exactly like the Builder's own save: the working version's
      // lines are fully owned by the composition that produced them.
      await tx.quoteLine.deleteMany({ where: { quoteVersionId: version.id } });
      if (mergedLines.length) {
        await tx.quoteLine.createMany({
          data: mergedLines.map(({ _from, _demoted, _sourceLineId, ...row }) => ({
            ...row,
            quoteVersionId: version.id,
          })),
        });
      }
      outcome.linesWritten = mergedLines.length;
      outcome.productLinesDemoted = mergedLines.filter((l) => l._demoted).length;
      mergedTotalMinor = mergedLines.length
        ? payableAfterMerge(
          computeMergedTotal({
            lines: mergedLines,
            vatMode: sourceVersion?.vatMode || null,
            priceListDefault: defaults.mode,
            vatRate: defaults.rate,
            dealDiscount,
          }).grossMinor,
          survivorSide.deal.noPaymentWaiver,
          mergedLines,
        )
        : Number((commercial.resolution === 'other' ? otherSide.deal.valueMinor : survivorSide.deal.valueMinor) || 0);
    }

    // ── 3. FIELDS + participants ────────────────────────────────────────────
    const fields = resolveFields(survivorSide.deal, otherSide.deal, decisions.fields || {});
    const participants = resolveParticipants(
      survivorSide.deal.participants, otherSide.deal.participants,
      decisions.participants, decisions.participantsCustom,
    );

    // The organization rule is canonical and re-applied here: a linked
    // organization DEFAULTS the activity type and force-clears the deal's own
    // type copy. Merging must not be the one path that bypasses it.
    const resultingOrgId = fields.patch.organizationId ?? null;
    const classification = normalizeClassification({
      organizationId: resultingOrgId,
      activityType: fields.patch.activityType ?? null,
      organizationTypeId: fields.patch.organizationTypeId ?? null,
      organizationSubtypeId: fields.patch.organizationSubtypeId ?? null,
      orgTypeId: resultingOrgId
        ? (await tx.organization.findUnique({ where: { id: resultingOrgId }, select: { organizationTypeId: true } }))?.organizationTypeId || null
        : null,
      subtypeTypeId: fields.patch.organizationSubtypeId
        ? (await tx.organizationSubtype.findUnique({ where: { id: fields.patch.organizationSubtypeId }, select: { organizationTypeId: true } }))?.organizationTypeId || null
        : null,
    });

    const dealPatch = {
      ...fields.patch,
      activityType: classification.activityType,
      organizationTypeId: classification.organizationTypeId,
      organizationSubtypeId: classification.organizationSubtypeId,
      valueMinor: BigInt(Math.round(mergedTotalMinor)),
    };
    if (participants.value != null) dealPatch.participants = participants.value;
    await tx.deal.update({ where: { id: survivorId }, data: dealPatch });

    // ── 4. OPERATIONAL ──────────────────────────────────────────────────────
    const operational = operationalSituation(survivorSide, otherSide, decisions.operational);
    const seatsForMerged = participants.value
      ?? (operational.mode === 'merge_seats'
        ? (survivorSide.booking?.seats || 0) + (otherSide.booking?.seats || 0)
        : null);

    if (operational.mode === 'adopt_other' || operational.mode === 'adopt_other_tour') {
      // Order is forced by the DB: Booking_one_active_per_deal_key is a partial
      // unique on (dealId) WHERE status='active', so the survivor's own active
      // booking must be gone before the adopted one carries its dealId.
      if (operational.mode === 'adopt_other_tour' && survivorSide.booking) {
        if (survivorSide.tourEvent?.kind !== 'group_slot') {
          outcome.planPreserved = await copyTourStateToPlan(tx, survivorId, survivorSide.tourEvent.id);
        }
        await cancelDealBooking(tx, survivorSide.booking, { reason: 'deal_merged', origin });
        outcome.bookingCancelled = survivorSide.booking.id;
      }
      const moved = await reparentBooking(tx, {
        booking: otherSide.booking,
        tourEvent: otherSide.tourEvent,
        fromDealId: retiredId,
        toDealId: survivorId,
        seats: seatsForMerged,
      });
      outcome.bookingReparented = moved.bookingId;
      outcome.registrationsMoved = moved.registrationsMoved;
    } else if (operational.mode === 'keep_survivor_tour') {
      if (otherSide.tourEvent?.kind !== 'group_slot') {
        outcome.planPreserved = await copyTourStateToPlan(tx, retiredId, otherSide.tourEvent.id);
      }
      await cancelDealBooking(tx, otherSide.booking, { reason: 'deal_merged', origin });
      outcome.bookingCancelled = otherSide.booking.id;
    } else if (operational.mode === 'merge_seats') {
      // Both deals sit on the SAME tour. The retired deal's booking is released
      // first (its seats stop counting), then the survivor's single booking
      // carries the combined count — so occupancy is never momentarily doubled.
      await cancelDealBooking(tx, otherSide.booking, { reason: 'deal_merged', origin });
      outcome.bookingCancelled = otherSide.booking.id;
      const seats = seatsForMerged ?? survivorSide.booking.seats;
      await tx.booking.update({ where: { id: survivorSide.booking.id }, data: { seats } });
      await syncDealRegistration(
        tx,
        { ...survivorSide.booking, seats, status: 'active' },
        survivorSide.tourEvent,
      );
      outcome.seatsMerged = seats;
    } else if (operational.mode === 'keep_survivor' && seatsForMerged != null && survivorSide.booking) {
      // The participant decision changed the count — the seat SSOT must follow,
      // or the tour roster silently disagrees with the deal.
      if (seatsForMerged !== survivorSide.booking.seats) {
        await tx.booking.update({ where: { id: survivorSide.booking.id }, data: { seats: seatsForMerged } });
        await syncDealRegistration(
          tx,
          { ...survivorSide.booking, seats: seatsForMerged, status: 'active' },
          survivorSide.tourEvent,
        );
      }
    }

    // ── 5. TASKS ────────────────────────────────────────────────────────────
    // Open tasks on the retired deal, per the operator's per-task decision.
    // Default 'move': an open task is future work someone still has to do, and
    // silently closing it would lose it. Nothing is ever DUPLICATED.
    const taskDecisions = decisions.tasks || {};
    const taskSuggestions = new Map(
      suggestTaskActions(survivorSide.tasks, otherSide.tasks).map((s) => [s.id, s]),
    );
    for (const task of otherSide.tasks) {
      const choice = resolveTaskAction(taskSuggestions.get(task.id), taskDecisions[task.id]);
      if (choice === 'close_duplicate') {
        // The canonical terminal shape (taskService.transitionTask): status +
        // cancelledAt. transitionTask itself opens its OWN transaction, so it
        // cannot be called from inside this one; the write it would perform is
        // reproduced exactly, and the history event is the merge's own.
        // updateMany, not update: the guard on `status` keeps a task that was
        // completed between preview and confirm from being reopened-as-cancelled,
        // and `status` is not part of any unique constraint so `update` could
        // not express it.
        const closed = await tx.task.updateMany({
          where: { id: task.id, status: 'open' },
          data: { status: 'cancelled', cancelledAt: new Date() },
        });
        outcome.tasksClosed += closed.count;
      } else if (choice === 'move') {
        await tx.task.update({ where: { id: task.id }, data: { dealId: survivorId } });
        outcome.tasksMoved += 1;
      }
      // 'keep' leaves the task on the retired deal — visible in its history.
    }

    // ── 6. STATUS ───────────────────────────────────────────────────────────
    const status = resolveStatus(survivorSide.deal.status, otherSide.deal.status, decisions.status);
    let wonTransition = null;
    if (status.triggersWonTransition) {
      // THE one non-WON→WON writer. Idempotent by construction, so a survivor
      // already WON (or won by a concurrent transaction) changes nothing and
      // fires nothing — "do not trigger duplicate WON lifecycle effects".
      wonTransition = await transitionDealToWon(tx, {
        dealId: survivorId,
        actorUserId,
        cause: 'deal_merge',
      });
    } else if (status.value !== survivorSide.deal.status && status.value !== 'won') {
      // open/lost realignment carries no lifecycle machinery of its own.
      await tx.deal.update({ where: { id: survivorId }, data: { status: status.value } });
    }

    // ── 7. RETIRE the other deal ────────────────────────────────────────────
    // Its row, its orderNo, its documents, its history and its timeline all stay
    // exactly as they are. Only its ACTIVE status ends.
    await tx.deal.update({
      where: { id: retiredId },
      data: { mergedIntoDealId: survivorId, mergedAt: new Date(), mergeOpId: opId },
    });

    // ── 8. THE audit record ─────────────────────────────────────────────────
    const merge = await tx.dealMerge.create({
      data: {
        survivorDealId: survivorId,
        survivorOrderNo: survivorSide.deal.orderNo,
        retiredDealId: retiredId,
        retiredOrderNo: otherSide.deal.orderNo,
        opId,
        actorUserId,
        actorName,
        decisions: {
          survivorDealId: survivorId,
          commercial: commercial.resolution,
          commercialLineIds: decisions.commercialLineIds || null,
          participants: participants.choice || participants.resolution,
          participantsValue: participants.value,
          status: status.value,
          statusSuggested: status.suggested,
          operational: operational.mode,
          allowOverbook: !!decisions.allowOverbook,
          primaryContactId: contacts.primaryContactId,
          fields: fields.fields
            .filter((f) => f.resolution === 'conflict' || f.resolution === 'other_only')
            .map((f) => ({ key: f.key, resolution: f.resolution, choice: f.choice || null })),
          tasks: taskDecisions,
        },
        outcome: {
          ...outcome,
          mergedTotalMinor,
          survivorPaidMinor: survivorSide.money.paidMinor,
          otherPaidMinor: otherSide.money.paidMinor,
          combinedPaidMinor: survivorSide.money.paidMinor + otherSide.money.paidMinor,
        },
      },
    });

    // ── 9. ONE readable audit event on each side ────────────────────────────
    // Deliberately its own timeline entry rather than a line in a changelog
    // group: a merge is the single most consequential thing that can happen to
    // a deal, and it must be findable in the history of BOTH deals.
    await emitTimelineEvent(tx, {
      subjectType: 'deal',
      subjectId: survivorId,
      kind: 'change',
      body: `🔗 דיל #${otherSide.deal.orderNo} אוחד לתוך דיל זה`,
      data: {
        // ChangeEventRow renders data.title as the headline (the questionnaire-
        // history mechanism) and ignores `body`. Without this the single most
        // consequential event on the deal would read "עדכון פרטים".
        title: `🔗 דיל #${otherSide.deal.orderNo} אוחד לתוך דיל זה`,
        event: 'deal_merge_survivor',
        mergeId: merge.id, opId,
        retiredDealId: retiredId, retiredOrderNo: otherSide.deal.orderNo,
        contactsLinked: outcome.contactsLinked,
        commercial: commercial.resolution,
        operational: operational.mode,
        actorUserId,
      },
      origin,
    });
    await emitTimelineEvent(tx, {
      subjectType: 'deal',
      subjectId: retiredId,
      kind: 'change',
      body: `🔗 דיל זה אוחד לתוך דיל #${survivorSide.deal.orderNo} ואינו פעיל יותר`,
      data: {
        title: `🔗 דיל זה אוחד לתוך דיל #${survivorSide.deal.orderNo} ואינו פעיל יותר`,
        event: 'deal_merge_retired',
        mergeId: merge.id, opId,
        survivorDealId: survivorId, survivorOrderNo: survivorSide.deal.orderNo,
        actorUserId,
      },
      origin,
    });

    return {
      alreadyDone: false,
      mergeId: merge.id,
      survivorDealId: survivorId,
      retiredDealId: retiredId,
      survivorOrderNo: survivorSide.deal.orderNo,
      retiredOrderNo: otherSide.deal.orderNo,
      outcome,
      mergedTotalMinor,
      combinedPaidMinor: survivorSide.money.paidMinor + otherSide.money.paidMinor,
      wonTransition: wonTransition?.wonNow
        ? { wonAt: wonTransition.wonAt, dealId: survivorId }
        : null,
      touchedTourEventIds: [survivorSide.tourEvent?.id, otherSide.tourEvent?.id].filter(Boolean),
    };
  });

  return out;
}

/**
 * The survivor's working QuoteVersion, created if it has none.
 *
 * A deal that was never priced has no version at all, and the merge is exactly
 * the moment it acquires one. Mirrors the Builder's own ensureWorkingVersion:
 * a primary offer, then a working draft under it.
 */
async function ensureSurvivorWorkingVersion(tx, dealId, existing) {
  if (existing) return existing;
  let offer = await tx.quoteOffer.findFirst({ where: { dealId, isPrimary: true }, select: { id: true } });
  if (!offer) {
    offer = await tx.quoteOffer.create({
      data: { dealId, offerNo: 1, isPrimary: true, contextMode: 'deal' },
      select: { id: true },
    });
  }
  return tx.quoteVersion.create({
    data: { dealId, offerId: offer.id, isWorking: true, status: 'draft' },
    select: { id: true },
  });
}

/**
 * Move a live booking and its seats from the retired deal to the survivor.
 *
 * The booking row is UPDATED, never cancelled-and-recreated: cancelling would
 * release real capacity on a real tour and immediately re-consume it, churning
 * Woo stock, the Google Calendar event and every scheduled message anchored to
 * it — to change one foreign key. The seats never stop being held, which is the
 * whole point: the customer's place on the tour is not at risk during a merge.
 */
async function reparentBooking(tx, { booking, tourEvent, fromDealId, toDealId, seats }) {
  const nextSeats = seats != null ? seats : booking.seats;
  await tx.booking.update({
    where: { id: booking.id },
    data: { dealId: toDealId, seats: nextSeats },
  });
  // The registrations hanging off this booking are the SEAT TRUTH. Their CRM
  // linkage moves with the booking; their identity, quantity and status do not.
  const regs = await tx.ticketRegistration.updateMany({
    where: { bookingId: booking.id },
    data: { dealId: toDealId, externalOrderId: toDealId },
  });
  // Any registration the retired deal held on this tour WITHOUT a booking link
  // (a held reservation from before WON) belongs to the survivor too — leaving
  // it behind would strand a seat on a deal that no longer exists actively.
  await tx.ticketRegistration.updateMany({
    where: { dealId: fromDealId, tourEventId: tourEvent.id, bookingId: null },
    data: { dealId: toDealId, externalOrderId: toDealId },
  });
  // Re-converge the seat SSOT under its new owner (also re-derives the tour's
  // operational product and marks the Woo mirror dirty for a group slot).
  await syncDealRegistration(
    tx,
    { ...booking, dealId: toDealId, seats: nextSeats, status: 'active' },
    tourEvent,
  );
  await emitTimelineEvent(tx, {
    subjectType: 'tour_event',
    subjectId: tourEvent.id,
    kind: 'tour',
    data: { event: 'booking_reparented_by_merge', fromDealId, toDealId, bookingId: booking.id },
  });
  return { bookingId: booking.id, registrationsMoved: regs.count };
}

// ── POST-COMMIT ─────────────────────────────────────────────────────────────

/**
 * The external effects, after the DB truth is already committed.
 *
 * Each one is isolated and idempotent: a failure here must NEVER be treated as
 * a failed merge — the merge really happened — so nothing throws, every outcome
 * is reported, and the caller raises a recovery card when anything came back
 * false. Re-running is always safe.
 */
export async function runMergeEffects(
  { survivorDealId, retiredDealId, survivorOrderNo, retiredOrderNo, touchedTourEventIds = [],
    mergedTotalMinor, combinedPaidMinor, currency = 'ILS', wonTransition = null, actorUserId = null,
    tasksChanged = false },
  { db = defaultPrisma, log = console } = {},
) {
  const results = { calendar: false, woo: false, payroll: false, reviewCard: null, won: false };

  // Tasks moved or closed by the merge — wake every open Tasks workspace, the
  // same post-commit hint every other task write emits.
  if (tasksChanged) {
    try {
      emitTasksChanged(db, { dealId: survivorDealId, reason: 'deal_merged' });
    } catch (e) {
      log.error(`[merge] tasks hint failed: ${e?.message || e}`);
    }
  }

  try {
    // Both tours were marked dirty inside the transaction by the canonical
    // writers; these only wake the reconcilers.
    kickTourCalendarSync();
    results.calendar = true;
  } catch (e) {
    log.error(`[merge] calendar kick failed: ${e?.message || e}`);
  }
  try {
    kickWooSync();
    results.woo = true;
  } catch (e) {
    log.error(`[merge] woo kick failed: ${e?.message || e}`);
  }
  try {
    for (const id of touchedTourEventIds) kickPayrollReconcile('tour', id);
    results.payroll = true;
  } catch (e) {
    log.error(`[merge] payroll reconcile failed: ${e?.message || e}`);
  }

  // A genuine non-WON→WON transition fires its effects exactly ONCE, through
  // the canonical emitter — never re-fired for a survivor that was already WON.
  if (wonTransition?.wonAt) {
    try {
      emitWonTransitionEffects(
        { dealId: survivorDealId, wonAt: wonTransition.wonAt, cause: 'deal_merge', closedByUserId: actorUserId },
        log,
      );
      results.won = true;
    } catch (e) {
      log.error(`[merge] won effects failed: ${e?.message || e}`);
    }
  }

  // Overpayment is an unmade BUSINESS decision, not a broken state: GOS never
  // fabricates a refund or a credit note. The card makes it impossible to miss.
  const overpaidMinor = Number(combinedPaidMinor || 0) - Number(mergedTotalMinor || 0);
  if (overpaidMinor > 0) {
    try {
      const { item } = await createReviewItem(
        {
          kind: DEAL_MERGE_OVERPAYMENT_KIND,
          dedupeKey: dealMergeOverpaymentKey(survivorDealId, overpaidMinor),
          title: `יתרת זכות לאחר איחוד דילים #${survivorOrderNo}`,
          summary:
            `לאחר איחוד דיל #${retiredOrderNo} לתוך דיל #${survivorOrderNo} שולם ${fmtMoney(combinedPaidMinor, currency)} `
            + `מול סכום משולב של ${fmtMoney(mergedTotalMinor, currency)} — יתרת זכות של ${fmtMoney(overpaidMinor, currency)}.`,
          dealId: survivorDealId,
          data: {
            orderNo: survivorOrderNo, retiredOrderNo,
            overpaidMinor, combinedPaidMinor, mergedTotalMinor, currency,
          },
        },
        { db },
      );
      results.reviewCard = item?.id || null;
    } catch (e) {
      log.error(`[merge] overpayment card failed: ${e?.message || e}`);
    }
  }

  results.ok = results.calendar && results.woo && results.payroll;
  return results;
}

export { MERGE_FIELDS };
