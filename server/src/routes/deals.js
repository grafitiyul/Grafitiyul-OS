import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { toClientLine, lineToData } from '../quote/quoteLineMapping.js';
import {
  ensureWorkingVersion,
  ensureDraftQuoteDocument,
  listDealQuoteDocuments,
  toClientQuoteDocument,
} from '../quote/quoteDocument.js';
import { createParallelOffer, activateOffer, setPrimaryOffer, removeOrArchiveOffer, unarchiveOffer, buildWonQuoteRef, splitBuilderPatch, updateOfferContext } from '../quote/quoteOffers.js';
import { ensurePaymentToken, paymentUrlFor, resolvePublicOrigin } from '../dealPayment.js';
import { recordDealChanges, recordDealContactChange, DEAL_DIFF_SELECT } from '../timeline/dealChangelog.js';
import { emitTimelineEvent, userOrigin } from '../timeline/events.js';
import { sendSimpleEmail } from '../email/simpleSend.js';
import {
  wonGate,
  activeBookingFor,
  createTourForWonDeal,
  cancelDealBooking,
  orphanDealBooking,
  syncDealToTour,
  pendingTourUpdate,
  GROUP_LOCKED_FIELDS,
} from '../tours/tourFromDeal.js';

// Deal CRUD + DealContact management. The Deal is the commercial object: it
// owns agreed value (integer minor units + currency), discount, payment terms,
// pipeline stage and outcome status. Operational execution and finance docs are
// separate and not built yet.
//
// Money: the client sends/receives plain numbers in MINOR units; Prisma stores
// BigInt. Incoming numbers are converted to BigInt here; outgoing BigInt is
// serialized to number by the app-level json replacer (see index.js).

const router = Router();

const VALID_STATUS = ['open', 'won', 'lost'];
const VALID_ACTIVITY_TYPES = ['group', 'private', 'business'];
// "פרטי הסיור" working-field enums (validated here; no Postgres enum). Payment
// method/term are NOT enum-validated — they hold values chosen from the CRM catalog.
const VALID_COMM_LANGS = ['he', 'en'];
const VALID_TOUR_LANGS = ['he', 'en', 'es', 'fr', 'ru'];
const VALID_ROLES = [
  // Operational quick-add roles (the day-to-day vocabulary).
  'ongoingBooking',
  'fieldRep',
  'finance',
  'endClient',
  // Original roles (kept for backward compatibility with existing data).
  'coordinator',
  'payer',
  'decisionMaker',
  'participant',
  'invoiceContact',
  'other',
];

function toMinor(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return BigInt(Math.round(n));
}

function cleanRoles(input) {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter((r) => VALID_ROLES.includes(r)))];
}

// Display name for changelog events (Hebrew first, English fallback — same
// convention as the timeline aggregate endpoint).
function contactDisplayName(c) {
  if (!c) return 'איש קשר';
  const he = `${c.firstNameHe || ''} ${c.lastNameHe || ''}`.trim();
  return he || `${c.firstNameEn || ''} ${c.lastNameEn || ''}`.trim() || 'איש קשר';
}

const CONTACT_NAME_SELECT = { firstNameHe: true, lastNameHe: true, firstNameEn: true, lastNameEn: true };

// Validate + copy the "פרטי הסיור" working fields from body → data. Only keys
// PRESENT in the body are touched, so partial (section) updates stay partial.
// Returns an error code string on invalid input, or null on success.
function applyTourFields(b, data) {
  if (b.tourDate !== undefined) data.tourDate = b.tourDate ? String(b.tourDate).trim() : null;
  if (b.tourTime !== undefined) data.tourTime = b.tourTime ? String(b.tourTime).trim() : null;
  if (b.participants !== undefined) {
    if (b.participants === null || b.participants === '') data.participants = null;
    else {
      const n = Number(b.participants);
      if (!Number.isInteger(n) || n < 0) return 'invalid_participants';
      data.participants = n;
    }
  }
  // (Payment method is handled as an FK — paymentMethodId — in the PUT handler;
  // the deprecated free-text paymentMethod is no longer written here.)
  if (b.communicationLanguage !== undefined) {
    if (b.communicationLanguage && !VALID_COMM_LANGS.includes(b.communicationLanguage)) return 'invalid_communication_language';
    data.communicationLanguage = b.communicationLanguage || null;
  }
  if (b.tourLanguage !== undefined) {
    if (b.tourLanguage && !VALID_TOUR_LANGS.includes(b.tourLanguage)) return 'invalid_tour_language';
    data.tourLanguage = b.tourLanguage || null;
  }
  // customerInfo is rich HTML — stored as-is (empty string normalises to null).
  if (b.customerInfo !== undefined) data.customerInfo = b.customerInfo ? String(b.customerInfo) : null;
  // quoteEmailIntro — plain text (commercial card). Empty normalises to null.
  if (b.quoteEmailIntro !== undefined) data.quoteEmailIntro = b.quoteEmailIntro ? String(b.quoteEmailIntro) : null;
  return null;
}

const CONTACT_SELECT = {
  id: true,
  firstNameHe: true,
  lastNameHe: true,
  firstNameEn: true,
  lastNameEn: true,
  // Contact-owned preference, surfaced (and editable) in the Deal contacts popup.
  // It lives on the Contact — the Deal never copies it.
  communicationLanguage: true,
  phones: { where: { isPrimary: true }, take: 1 },
  emails: { where: { isPrimary: true }, take: 1 },
};

const DEAL_INCLUDE = {
  dealStage: true,
  organization: {
    select: { id: true, name: true, organizationTypeId: true, organizationType: { select: { id: true, label: true } } },
  },
  organizationUnit: { select: { id: true, name: true } },
  organizationSubtype: { select: { id: true, label: true, organizationTypeId: true } },
  // The Deal's own org type — only meaningful while no organization is linked.
  organizationType: { select: { id: true, label: true } },
  dealSource: { select: { id: true, label: true } },
  lostReasonRef: { select: { id: true, nameHe: true, nameEn: true } },
  contacts: {
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    include: { contact: { select: CONTACT_SELECT } },
  },
  // The deal's CURRENT personal iCount link (latest non-superseded row). History
  // rows stay in the table; the UI only ever shows/acts on this one.
  paymentLinks: {
    where: { status: 'created' },
    orderBy: { createdAt: 'desc' },
    take: 1,
  },
  // Tours: the deal's live tour connection (active) and any kept-behind orphan
  // (reopen with "keep the tour"). Cancelled booking history is not needed by
  // the workspace and stays out of the payload.
  bookings: {
    where: { status: { in: ['active', 'orphaned'] } },
    orderBy: { createdAt: 'desc' },
    include: {
      tourEvent: {
        select: {
          id: true,
          kind: true,
          status: true,
          date: true,
          startTime: true,
          capacity: true,
          tourLanguage: true,
          // Scalar FKs feed pendingTourUpdate (deal-vs-tour diff) — the
          // APPLIED side of the pending-update concept.
          productId: true,
          productVariantId: true,
          locationId: true,
          product: { select: { id: true, nameHe: true } },
          location: { select: { id: true, nameHe: true } },
        },
      },
    },
  },
};

// Compact tour payload for 409 choice dialogs (reopen / lost with a live tour).
function tourChoicePayload(booking) {
  return {
    bookingId: booking.id,
    tourEventId: booking.tourEventId,
    kind: booking.tourEvent.kind,
    date: booking.tourEvent.date,
    startTime: booking.tourEvent.startTime,
    seats: booking.seats,
  };
}

async function loadDeal(id) {
  return prisma.deal.findUnique({ where: { id }, include: DEAL_INCLUDE });
}

// Attach the DERIVED pending-tour-update diff (deal = desired vs tour =
// applied; see tourFromDeal.js) to a workspace deal payload. Computed on read
// from data already in DEAL_INCLUDE — nothing stored, nothing to go stale.
function withTourUpdatePending(deal) {
  if (!deal) return deal;
  const booking = (deal.bookings || []).find((bk) => bk.status === 'active') || null;
  return { ...deal, tourUpdatePending: pendingTourUpdate(deal, booking) };
}

// "מספר הזמנה" URL support — every /:id route on this router accepts EITHER the
// internal cuid OR the business-facing sequential order number (all digits;
// cuids never are). The one resolver below swaps a numeric id for the cuid
// before any handler runs, so no handler needs to know which form arrived.
// Unknown numbers fall through unchanged → the handler's own lookup 404s.
router.param('id', (req, _res, next, value) => {
  if (!/^\d+$/.test(value)) return next();
  const orderNo = Number(value);
  if (!Number.isSafeInteger(orderNo) || orderNo > 2147483647) return next();
  prisma.deal
    .findUnique({ where: { orderNo }, select: { id: true } })
    .then((found) => {
      if (found) req.params.id = found.id;
      next();
    })
    .catch(next);
});

// ---------- Deals ----------

router.get(
  '/',
  handle(async (req, res) => {
    const where = {};
    if (req.query.status && VALID_STATUS.includes(String(req.query.status))) {
      where.status = String(req.query.status);
    }
    if (req.query.organizationId) {
      where.organizationId = String(req.query.organizationId);
    }
    const deals = await prisma.deal.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        dealStage: { select: { id: true, label: true } },
        organization: { select: { id: true, name: true } },
        organizationUnit: { select: { id: true, name: true } },
        organizationSubtype: { select: { id: true, label: true } },
        lostReasonRef: { select: { id: true, nameHe: true } },
        // Only the primary contact is needed for the optional "primary contact"
        // table column — keep the payload lean (don't ship every contact).
        contacts: {
          where: { isPrimary: true },
          take: 1,
          select: {
            contact: {
              select: {
                firstNameHe: true,
                lastNameHe: true,
                firstNameEn: true,
                lastNameEn: true,
              },
            },
          },
        },
        _count: { select: { contacts: true } },
      },
    });
    res.json(deals);
  }),
);

router.get(
  '/:id',
  handle(async (req, res) => {
    const deal = await loadDeal(req.params.id);
    if (!deal) return res.status(404).json({ error: 'not_found' });
    res.json(withTourUpdatePending(deal));
  }),
);

router.post(
  '/',
  handle(async (req, res) => {
    const b = req.body || {};
    const title = String(b.title || '').trim();
    if (!title) return res.status(400).json({ error: 'title_required' });

    // Resolve the stage: explicit, else the first pipeline stage.
    let dealStageId = b.dealStageId || null;
    if (!dealStageId) {
      const first = await prisma.dealStage.findFirst({
        orderBy: { sortOrder: 'asc' },
        select: { id: true },
      });
      if (!first) return res.status(400).json({ error: 'no_stages' });
      dealStageId = first.id;
    }

    // activityType: validate against the catalog (or null).
    let activityType = null;
    if (b.activityType) {
      if (!VALID_ACTIVITY_TYPES.includes(b.activityType)) {
        return res.status(400).json({ error: 'invalid_activity_type' });
      }
      activityType = b.activityType;
    }
    // Deal.organizationTypeId = this deal's quote/business classification, kept
    // independently of any linked organization (which only supplies a default type).
    const organizationTypeId = b.organizationTypeId || null;

    const data = {
      title,
      dealStageId,
      status: 'open',
      activityType,
      organizationTypeId,
      dealSourceId: b.dealSourceId || null,
      productId: b.productId || null,
      productVariantId: b.productVariantId || null,
      locationId: b.locationId || null,
      paymentTermId: b.paymentTermId || null,
      paymentMethodId: b.paymentMethodId || null,
      basePriceOverridden: !!b.basePriceOverridden,
      organizationId: b.organizationId || null,
      organizationUnitId: b.organizationUnitId || null,
      organizationSubtypeId: b.organizationSubtypeId || null,
      valueMinor: toMinor(b.valueMinor) ?? 0n,
      currency: b.currency ? String(b.currency).trim() : 'ILS',
      discountMinor: toMinor(b.discountMinor),
      source: b.source ? String(b.source).trim() : null,
      expectedCloseDate: b.expectedCloseDate
        ? new Date(b.expectedCloseDate)
        : null,
      notes: b.notes ? String(b.notes).trim() : null,
    };
    const tourErr = applyTourFields(b, data);
    if (tourErr) return res.status(400).json({ error: tourErr });

    const deal = await prisma.deal.create({ data, include: DEAL_INCLUDE });
    res.status(201).json(deal);
  }),
);

router.put(
  '/:id',
  handle(async (req, res) => {
    const b = req.body || {};
    // Snapshot every changelog-tracked scalar (includes status/organizationId
    // used below) — the "before" side of the structured history diff.
    // productVariantId/orderNo ride along for the Tours gate + timeline events
    // (untracked by the changelog, harmless in the snapshot).
    const existing = await prisma.deal.findUnique({
      where: { id: req.params.id },
      select: { ...DEAL_DIFF_SELECT, productVariantId: true, orderNo: true },
    });
    if (!existing) return res.status(404).json({ error: 'not_found' });

    const data = {};
    if (b.title !== undefined) {
      const t = String(b.title).trim();
      if (!t) return res.status(400).json({ error: 'title_required' });
      data.title = t;
    }
    if (b.dealStageId !== undefined) data.dealStageId = b.dealStageId;
    if (b.organizationId !== undefined)
      data.organizationId = b.organizationId || null;
    if (b.organizationUnitId !== undefined)
      data.organizationUnitId = b.organizationUnitId || null;
    if (b.organizationSubtypeId !== undefined)
      data.organizationSubtypeId = b.organizationSubtypeId || null;
    if (b.dealSourceId !== undefined)
      data.dealSourceId = b.dealSourceId || null;
    // Operational product/location selection + base-price override flag. FKs are
    // validated by Prisma; SetNull on the relation keeps deletes safe.
    if (b.productId !== undefined) data.productId = b.productId || null;
    if (b.productVariantId !== undefined)
      data.productVariantId = b.productVariantId || null;
    if (b.locationId !== undefined) data.locationId = b.locationId || null;
    // Payment — FK to the CRM catalog (IDs only; the deprecated string fields are
    // never written). Prisma validates the FK (must exist or be null).
    if (b.paymentTermId !== undefined) data.paymentTermId = b.paymentTermId || null;
    if (b.paymentMethodId !== undefined) data.paymentMethodId = b.paymentMethodId || null;
    if (b.basePriceOverridden !== undefined)
      data.basePriceOverridden = !!b.basePriceOverridden;
    if (b.activityType !== undefined) {
      if (b.activityType && !VALID_ACTIVITY_TYPES.includes(b.activityType)) {
        return res.status(400).json({ error: 'invalid_activity_type' });
      }
      data.activityType = b.activityType || null;
    }
    // Deal.organizationTypeId = THIS deal's quote/business classification. It is
    // independent of any linked organization: the organization's own type is only a
    // DEFAULT, and a deal may override it for the quote context (the composer reads
    // deal.organizationType first, org type as fallback). So it is persisted exactly
    // as sent — NOT force-cleared when an organization is linked.
    if (b.organizationTypeId !== undefined)
      data.organizationTypeId = b.organizationTypeId || null;
    if (b.valueMinor !== undefined) data.valueMinor = toMinor(b.valueMinor) ?? 0n;
    if (b.currency !== undefined) data.currency = String(b.currency).trim() || 'ILS';
    if (b.discountMinor !== undefined) data.discountMinor = toMinor(b.discountMinor);
    // NOTE: the deprecated free-text paymentTerms/paymentMethod are intentionally
    // no longer written — payment is stored via paymentTermId/paymentMethodId above.
    if (b.source !== undefined) data.source = b.source ? String(b.source).trim() : null;
    if (b.expectedCloseDate !== undefined)
      data.expectedCloseDate = b.expectedCloseDate
        ? new Date(b.expectedCloseDate)
        : null;
    if (b.notes !== undefined) data.notes = b.notes ? String(b.notes).trim() : null;

    // "פרטי הסיור" working fields (partial — only present keys are touched).
    const tourErr = applyTourFields(b, data);
    if (tourErr) return res.status(400).json({ error: tourErr });

    // Outcome status transitions stamp/clear wonAt/lostAt. LOST now stores
    // STRUCTURED data: a required lostReasonId (FK to the LostReason catalog)
    // plus optional lostNotes. The legacy free-text `lostReason` is cleared on
    // any structured save (it only survives as a fallback on un-migrated rows).
    if (b.status !== undefined) {
      if (!VALID_STATUS.includes(b.status)) {
        return res.status(400).json({ error: 'invalid_status' });
      }
      data.status = b.status;
      if (b.status === 'won') {
        data.wonAt = new Date();
        data.lostAt = null;
        data.lostReasonId = null;
        data.lostNotes = null;
        data.lostReason = null;
        // Stamp the PRIMARY quote this win is based on — only on the actual
        // transition into WON (a re-save of an already-won deal never
        // silently re-points the audit record).
        if (existing.status !== 'won') {
          const ref = await buildWonQuoteRef(prisma, req.params.id);
          data.wonQuoteRef = ref
            ? { ...ref, publicUrl: `${resolvePublicOrigin(req)}/quote/${ref.publicToken}`, stampedAt: new Date().toISOString() }
            : null;
        }
      } else if (b.status === 'lost') {
        const reasonId = b.lostReasonId ? String(b.lostReasonId) : null;
        if (!reasonId) return res.status(400).json({ error: 'lost_reason_required' });
        const reason = await prisma.lostReason.findUnique({
          where: { id: reasonId },
          select: { id: true },
        });
        if (!reason) return res.status(400).json({ error: 'lost_reason_invalid' });
        data.lostAt = new Date();
        data.wonAt = null;
        data.lostReasonId = reasonId;
        data.lostNotes = b.lostNotes ? String(b.lostNotes).trim() : null;
        data.lostReason = null;
      } else {
        // REOPEN (→ 'open') is ONLY a status change. We intentionally preserve
        // the WON/LOST history (wonAt, lostAt, lostReasonId, lostNotes,
        // lostReason) so reopening never destroys historical data.
      }
    } else if (
      existing.status === 'lost' &&
      (b.lostReasonId !== undefined || b.lostNotes !== undefined)
    ) {
      // Editing the structured loss data without a status change.
      if (b.lostReasonId !== undefined) {
        const reasonId = b.lostReasonId ? String(b.lostReasonId) : null;
        if (!reasonId) return res.status(400).json({ error: 'lost_reason_required' });
        const reason = await prisma.lostReason.findUnique({
          where: { id: reasonId },
          select: { id: true },
        });
        if (!reason) return res.status(400).json({ error: 'lost_reason_invalid' });
        data.lostReasonId = reasonId;
        data.lostReason = null;
      }
      if (b.lostNotes !== undefined) {
        data.lostNotes = b.lostNotes ? String(b.lostNotes).trim() : null;
      }
    }

    // ── Tours lifecycle gates (product decisions, see src/tours/tourFromDeal.js) ──
    const activeBooking = await activeBookingFor(prisma, req.params.id);
    const wonTransition = b.status === 'won' && existing.status !== 'won';
    const lostTransition = b.status === 'lost' && existing.status !== 'lost';
    const reopenTransition = b.status === 'open' && existing.status === 'won';

    // A deal joined to a GROUP slot cannot edit slot-owned planning fields —
    // the slot is authoritative; moving = "החלף סיור" (the tour-booking route).
    if (activeBooking?.tourEvent.kind === 'group_slot') {
      const touched = GROUP_LOCKED_FIELDS.filter(
        (f) => f in data && (data[f] ?? null) !== (existing[f] ?? null),
      );
      if (touched.length) {
        return res.status(409).json({ error: 'group_tour_fields_locked', fields: touched });
      }
    }

    if (wonTransition) {
      // NO draft tours: WON is refused while required fields are missing. The
      // list is declarative (requiredFields.js) — merged over this same save so
      // "fill field + WON" in one request works.
      const gate = wonGate({ ...existing, ...data }, b.tourEventId);
      if (gate.missing.length) {
        return res.status(422).json({
          error: 'won_requirements_missing',
          missing: gate.missing,
          activityType: data.activityType ?? existing.activityType ?? null,
        });
      }
      if (gate.needsSlot) {
        return res.status(422).json({ error: 'tour_slot_required' });
      }
    }
    if (reopenTransition && activeBooking && b.tourChoice !== 'remove' && b.tourChoice !== 'keep') {
      // Never disconnect automatically — the operator chooses.
      return res.status(409).json({ error: 'tour_choice_required', tour: tourChoicePayload(activeBooking) });
    }
    if (lostTransition && activeBooking && b.confirmTourCancel !== true) {
      // LOST cancels tour participation — requires explicit confirmation.
      return res.status(409).json({ error: 'tour_cancel_confirm_required', tour: tourChoicePayload(activeBooking) });
    }

    const origin = await userOrigin(req.adminAuth?.userId);
    let deal;
    try {
      deal = await prisma.$transaction(async (tx) => {
        let updated = await tx.deal.update({
          where: { id: req.params.id },
          data,
          include: DEAL_INCLUDE,
        });
        if (wonTransition) {
          // First WON creates (private/business) or joins (group) the tour.
          const { dealSync } = await createTourForWonDeal(tx, updated, {
            targetTourEventId: b.tourEventId,
            origin,
          });
          if (dealSync) {
            // Group slot is authoritative — sync its fields onto the deal in
            // the same transaction (changelog picks them up below).
            updated = await tx.deal.update({
              where: { id: updated.id },
              data: dealSync,
              include: DEAL_INCLUDE,
            });
          }
        } else if (activeBooking && reopenTransition) {
          if (b.tourChoice === 'remove') {
            await cancelDealBooking(tx, activeBooking, { reason: 'deal_reopened', origin });
          } else {
            await orphanDealBooking(tx, activeBooking, { origin });
          }
        } else if (activeBooking && lostTransition) {
          await cancelDealBooking(tx, activeBooking, { reason: 'deal_lost', origin });
        } else if (activeBooking && activeBooking.tourEvent.kind === 'group_slot') {
          // Group save: the slot owns planning (fields are locked above); only
          // the seats↔participants mirror runs.
          await syncDealToTour(tx, updated, activeBooking, { origin });
        }
        // private/business with a live tour: NO auto-sync. Deal saves
        // accumulate as a PENDING tour update (pendingTourUpdate — the derived
        // deal-vs-tour diff); the operator applies explicitly via
        // POST /:id/apply-tour-update ("עדכון סיור").
        return updated;
      });
    } catch (e) {
      if (e.code === 'tour_slot_invalid' || e.code === 'tour_slot_not_scheduled') {
        return res.status(422).json({ error: e.code });
      }
      throw e;
    }
    // Booking state changed inside the transaction — re-read so the response
    // reflects it (DEAL_INCLUDE.bookings was captured by the first update).
    if (wonTransition || reopenTransition || lostTransition) {
      deal = await loadDeal(req.params.id);
    }
    // Structured changelog → Deal history (grouped per save; no-op when nothing
    // tracked actually changed). Never blocks the save itself.
    await recordDealChanges(prisma, {
      dealId: req.params.id,
      before: existing,
      after: deal,
      origin,
    });
    // WON audit trail: which proposal the win was based on (or none).
    if (b.status === 'won' && existing.status !== 'won' && deal.wonQuoteRef) {
      await emitTimelineEvent(prisma, {
        subjectType: 'deal',
        subjectId: req.params.id,
        kind: 'quote',
        data: { event: 'won_reference', ...deal.wonQuoteRef },
        origin,
      });
    }
    res.json(withTourUpdatePending(deal));
  }),
);

// "עדכון סיור" — apply the PENDING tour update: the ONE business action that
// converges the live tour onto the deal's desired state. One orchestration:
// syncDealToTour updates the TourEvent (date/time/variant/language/city) +
// seats and marks the Google Calendar mirror dirty — the sync worker then
// converges the event (duration via variant, location line, attendee updates)
// asynchronously. Future tour-affecting workflows join HERE, never scattered.
router.post(
  '/:id/apply-tour-update',
  handle(async (req, res) => {
    const deal = await prisma.deal.findUnique({ where: { id: req.params.id } });
    if (!deal) return res.status(404).json({ error: 'not_found' });
    const booking = await activeBookingFor(prisma, deal.id);
    if (!booking || booking.tourEvent.kind === 'group_slot') {
      return res.status(409).json({ error: 'no_updatable_tour' });
    }
    const pending = pendingTourUpdate(deal, booking);
    if (pending.length) {
      const origin = await userOrigin(req.adminAuth?.userId);
      await prisma.$transaction(async (tx) => {
        await syncDealToTour(tx, deal, booking, { origin });
        await emitTimelineEvent(tx, {
          subjectType: 'deal',
          subjectId: deal.id,
          kind: 'tour',
          data: {
            event: 'tour_update_applied',
            tourEventId: booking.tourEventId,
            fields: pending.map((p) => p.field),
          },
          origin,
        });
      });
    }
    res.json(withTourUpdatePending(await loadDeal(deal.id)));
  }),
);

// "ביטול שינויים" — discard the pending update: restore the deal's planning
// fields back to the CURRENTLY-APPLIED tour values. Nothing operational
// happens — no tour mutation, no calendar mark, and INTENTIONALLY no changelog
// / timeline entry (restoring the applied state is not a business change).
router.post(
  '/:id/discard-tour-update',
  handle(async (req, res) => {
    const deal = await prisma.deal.findUnique({ where: { id: req.params.id } });
    if (!deal) return res.status(404).json({ error: 'not_found' });
    const booking = await activeBookingFor(prisma, deal.id);
    if (!booking || booking.tourEvent.kind === 'group_slot') {
      return res.status(409).json({ error: 'no_updatable_tour' });
    }
    const tour = booking.tourEvent;
    const data = {
      tourDate: tour.date,
      tourTime: tour.startTime,
      tourLanguage: tour.tourLanguage,
      productId: tour.productId,
      productVariantId: tour.productVariantId,
      locationId: tour.locationId,
    };
    if (Number.isInteger(booking.seats) && booking.seats >= 1) data.participants = booking.seats;
    await prisma.deal.update({ where: { id: deal.id }, data });
    res.json(withTourUpdatePending(await loadDeal(deal.id)));
  }),
);

// "שבץ לסיור" / "החלף סיור" — attach a WON group deal to a scheduled group
// slot, replacing its current booking if one exists. The slot is authoritative:
// its planning fields are synced onto the deal (with changelog). Overbooking is
// allowed — capacity is a warning the client shows before calling this.
router.post(
  '/:id/tour-booking',
  handle(async (req, res) => {
    const tourEventId = req.body?.tourEventId ? String(req.body.tourEventId) : '';
    if (!tourEventId) return res.status(400).json({ error: 'tour_event_required' });
    const before = await prisma.deal.findUnique({
      where: { id: req.params.id },
      select: { ...DEAL_DIFF_SELECT, productVariantId: true, orderNo: true },
    });
    if (!before) return res.status(404).json({ error: 'not_found' });
    if (before.status !== 'won') return res.status(409).json({ error: 'deal_not_won' });
    if (before.activityType !== 'group') return res.status(409).json({ error: 'not_group_deal' });
    if (!Number.isInteger(Number(before.participants)) || Number(before.participants) < 1) {
      return res.status(422).json({
        error: 'won_requirements_missing',
        missing: [{ field: 'participants', labelHe: 'משתתפים' }],
      });
    }

    const origin = await userOrigin(req.adminAuth?.userId);
    let deal;
    try {
      deal = await prisma.$transaction(async (tx) => {
        const current = await activeBookingFor(tx, req.params.id);
        if (current?.tourEventId === tourEventId) return null; // already there
        if (current) {
          await cancelDealBooking(tx, current, { reason: 'tour_replaced', origin });
        }
        const full = await tx.deal.findUnique({ where: { id: req.params.id } });
        const { dealSync } = await createTourForWonDeal(tx, full, {
          targetTourEventId: tourEventId,
          origin,
        });
        return tx.deal.update({
          where: { id: req.params.id },
          data: dealSync || {},
          include: DEAL_INCLUDE,
        });
      });
    } catch (e) {
      if (e.code === 'tour_slot_invalid' || e.code === 'tour_slot_not_scheduled') {
        return res.status(422).json({ error: e.code });
      }
      throw e;
    }
    if (!deal) return res.json(await loadDeal(req.params.id));
    await recordDealChanges(prisma, { dealId: req.params.id, before, after: deal, origin });
    res.json(await loadDeal(req.params.id));
  }),
);

router.delete(
  '/:id',
  handle(async (req, res) => {
    // Tour bookings (any status — history included) block deletion by product
    // rule + DB Restrict: operational work is never silently destroyed. The
    // deal must be disconnected from its tour first.
    const bookingCount = await prisma.booking.count({ where: { dealId: req.params.id } });
    if (bookingCount > 0) {
      return res.status(409).json({ error: 'deal_has_tour_bookings' });
    }
    // DealContacts cascade. Organizations/contacts/stages are not deleted.
    await prisma.deal.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

// ---------- Deal contacts ----------
// A deal may have multiple contacts with different roles + comm preferences.
// At most one primary per deal (enforced here).

const PREF_FIELDS = [
  'receiveConfirmations',
  'receiveOperationalUpdates',
  'receivePaymentLinks',
  'receiveQuotes',
];

router.post(
  '/:id/contacts',
  handle(async (req, res) => {
    const b = req.body || {};
    const contactId = String(b.contactId || '').trim();
    if (!contactId) return res.status(400).json({ error: 'contactId_required' });
    const makePrimary = !!b.isPrimary;
    const data = {
      dealId: req.params.id,
      contactId,
      roles: cleanRoles(b.roles),
      isPrimary: makePrimary,
    };
    for (const f of PREF_FIELDS) data[f] = !!b[f];
    try {
      await prisma.$transaction(async (tx) => {
        if (makePrimary) {
          await tx.dealContact.updateMany({
            where: { dealId: req.params.id, isPrimary: true },
            data: { isPrimary: false },
          });
        }
        await tx.dealContact.create({ data });
      });
    } catch (e) {
      if (e.code === 'P2002')
        return res.status(409).json({ error: 'contact_already_linked' });
      throw e;
    }
    const linkedContact = await prisma.contact.findUnique({ where: { id: contactId }, select: CONTACT_NAME_SELECT });
    await recordDealContactChange(prisma, {
      dealId: req.params.id,
      event: 'linked',
      contactName: contactDisplayName(linkedContact),
      origin: await userOrigin(req.adminAuth?.userId),
    });
    res.status(201).json(await loadDeal(req.params.id));
  }),
);

router.put(
  '/contacts/:linkId',
  handle(async (req, res) => {
    const b = req.body || {};
    const link = await prisma.dealContact.findUnique({
      where: { id: req.params.linkId },
    });
    if (!link) return res.status(404).json({ error: 'not_found' });
    const data = {};
    if (b.roles !== undefined) data.roles = cleanRoles(b.roles);
    for (const f of PREF_FIELDS) if (b[f] !== undefined) data[f] = !!b[f];
    // Changelog: capture the outgoing primary BEFORE the transaction flips it.
    const becomesPrimary = b.isPrimary === true && !link.isPrimary;
    const prevPrimary = becomesPrimary
      ? await prisma.dealContact.findFirst({
          where: { dealId: link.dealId, isPrimary: true },
          select: { contact: { select: CONTACT_NAME_SELECT } },
        })
      : null;
    await prisma.$transaction(async (tx) => {
      if (b.isPrimary === true) {
        await tx.dealContact.updateMany({
          where: { dealId: link.dealId, isPrimary: true },
          data: { isPrimary: false },
        });
        data.isPrimary = true;
      } else if (b.isPrimary === false) {
        data.isPrimary = false;
      }
      await tx.dealContact.update({ where: { id: link.id }, data });
    });
    if (becomesPrimary) {
      const c = await prisma.contact.findUnique({ where: { id: link.contactId }, select: CONTACT_NAME_SELECT });
      await recordDealContactChange(prisma, {
        dealId: link.dealId,
        event: 'primary',
        contactName: contactDisplayName(c),
        oldName: prevPrimary ? contactDisplayName(prevPrimary.contact) : null,
        origin: await userOrigin(req.adminAuth?.userId),
      });
    }
    res.json(await loadDeal(link.dealId));
  }),
);

router.delete(
  '/contacts/:linkId',
  handle(async (req, res) => {
    const link = await prisma.dealContact.findUnique({
      where: { id: req.params.linkId },
      include: { contact: { select: CONTACT_NAME_SELECT } },
    });
    if (!link) return res.status(404).json({ error: 'not_found' });
    await prisma.dealContact.delete({ where: { id: link.id } });
    await recordDealContactChange(prisma, {
      dealId: link.dealId,
      event: 'unlinked',
      contactName: contactDisplayName(link.contact),
      origin: await userOrigin(req.adminAuth?.userId),
    });
    res.json(await loadDeal(link.dealId));
  }),
);

// ── Price Builder lines (canonical QuoteVersion + QuoteLine storage) ─────────
// Each deal has exactly ONE working QuoteVersion for now (no quote workflow yet).
// The builder reads/writes that version's lines. The client line shape uses a
// generic `refId`; we translate it to the typed FK by kind (product → variant,
// addon → addon). The total comes from the engine (/api/pricing/builder) and is
// passed through to Deal.valueMinor — the headline summary cache.

// ensureWorkingVersion is shared with the Quote module (../quote/quoteDocument.js).

router.get(
  '/:id/price-lines',
  handle(async (req, res) => {
    const deal = await prisma.deal.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!deal) return res.status(404).json({ error: 'not_found' });
    // `created` lets the client seed a default line for a brand-new deal while
    // letting an existing deal legitimately have zero lines (user deleted them).
    let version = await prisma.quoteVersion.findFirst({ where: { dealId: req.params.id, isWorking: true } });
    let created = false;
    if (!version) {
      version = await prisma.quoteVersion.create({ data: { dealId: req.params.id, isWorking: true, status: 'draft' } });
      created = true;
    }
    const lines = await prisma.quoteLine.findMany({
      where: { quoteVersionId: version.id },
      orderBy: { sortOrder: 'asc' },
    });
    res.json({ versionId: version.id, created, lines: lines.map(toClientLine) });
  }),
);

router.put(
  '/:id/price-lines',
  handle(async (req, res) => {
    const b = req.body || {};
    // Full diff snapshot (not just existence): the builder patch may change
    // price/product/city/participants — those belong in the Deal changelog too.
    const before = await prisma.deal.findUnique({ where: { id: req.params.id }, select: DEAL_DIFF_SELECT });
    if (!before) return res.status(404).json({ error: 'not_found' });
    const inputLines = Array.isArray(b.lines) ? b.lines : [];
    const rows = inputLines.map((ln, i) => lineToData(ln, i));

    const versionId = await prisma.$transaction(async (tx) => {
      const version = await ensureWorkingVersion(tx, req.params.id);
      // Replace-sync: the working version's lines are fully owned by the builder.
      await tx.quoteLine.deleteMany({ where: { quoteVersionId: version.id } });
      if (rows.length) {
        await tx.quoteLine.createMany({
          data: rows.map((r) => ({ ...r, quoteVersionId: version.id })),
        });
      }
      // Headline cache + the product/city/participants this was priced against.
      // Routed by the ACTIVE offer's context mode: primary (deal-mode) patches
      // the Deal exactly as always (Deal ≡ primary); a non-primary own-mode
      // offer keeps its context to ITSELF — pricing an alternative never
      // mutates the Deal (the ציפי-2 lesson).
      const offer = version.offerId
        ? await tx.quoteOffer.findUnique({ where: { id: version.offerId } })
        : null;
      const { dealPatch, offerPatch } = splitBuilderPatch(offer, b);
      if (Object.keys(dealPatch).length) await tx.deal.update({ where: { id: req.params.id }, data: dealPatch });
      if (Object.keys(offerPatch).length) await tx.quoteOffer.update({ where: { id: offer.id }, data: offerPatch });
      return version.id;
    });

    // Changelog for the headline fields the builder just patched (diff-based,
    // so an unchanged re-save emits nothing).
    const after = await prisma.deal.findUnique({ where: { id: req.params.id }, select: DEAL_DIFF_SELECT });
    if (after) {
      await recordDealChanges(prisma, {
        dealId: req.params.id,
        before,
        after,
        origin: await userOrigin(req.adminAuth?.userId),
      });
    }

    const lines = await prisma.quoteLine.findMany({
      where: { quoteVersionId: versionId },
      orderBy: { sortOrder: 'asc' },
    });
    res.json({ versionId, lines: lines.map(toClientLine) });
  }),
);

// ── Quote document (Slice 1) ─────────────────────────────────────────────────
// Ensure a single DRAFT QuoteDocument exists for this deal's working QuoteVersion
// and return it (creating it if missing — like /:id/price-lines auto-creates the
// working version). No produce/render/public page yet.
router.get(
  '/:id/quote-document',
  handle(async (req, res) => {
    const result = await ensureDraftQuoteDocument(prisma, req.params.id);
    if (result.error === 'not_found') return res.status(404).json({ error: 'not_found' });
    res.json({ quoteDocument: toClientQuoteDocument(result.doc), created: result.created });
  }),
);

// All offers of this deal with their PRODUCED (immutable) quote documents —
// feeds the Deal quote card + the quote-history popup. Drafts excluded.
router.get(
  '/:id/quote-documents',
  handle(async (req, res) => {
    const r = await listDealQuoteDocuments(prisma, req.params.id);
    res.json({ ...r, publicOrigin: resolvePublicOrigin(req) });
  }),
);

// Create a parallel offer (independent commercial alternative — its own
// versions, history and permanent URLs) and make it the active one.
router.post(
  '/:id/quote-offers',
  handle(async (req, res) => {
    const r = await createParallelOffer(prisma, req.params.id);
    if (r.error === 'not_found') return res.status(404).json({ error: 'not_found' });
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ offer: { id: r.offer.id, offerNo: r.offer.offerNo, isPrimary: r.offer.isPrimary } });
  }),
);

// Switch the ACTIVE offer (Builder context + generation target).
router.post(
  '/:id/quote-offers/:offerId/activate',
  handle(async (req, res) => {
    const r = await activateOffer(prisma, req.params.id, req.params.offerId);
    if (r.error === 'not_found') return res.status(404).json({ error: 'not_found' });
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true });
  }),
);

// Remove an offer: hard-delete only when nothing was ever generated; archive
// (hide from tabs, keep history + permanent URLs) when documents exist; refuse
// when a signed document exists.
router.delete(
  '/:id/quote-offers/:offerId',
  handle(async (req, res) => {
    const r = await removeOrArchiveOffer(prisma, req.params.id, req.params.offerId);
    if (r.error === 'not_found') return res.status(404).json({ error: 'not_found' });
    if (r.error === 'has_signed') return res.status(409).json({ error: 'has_signed' });
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ mode: r.mode });
  }),
);

// Update an OWN-mode (non-primary) offer's commercial context. The Deal is
// never touched — this is the whole point of parallel offers.
router.put(
  '/:id/quote-offers/:offerId/context',
  handle(async (req, res) => {
    const r = await updateOfferContext(prisma, req.params.id, req.params.offerId, req.body || {});
    if (r.error === 'not_found') return res.status(404).json({ error: 'not_found' });
    if (r.error === 'archived' || r.error === 'primary_follows_deal') return res.status(409).json({ error: r.error });
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true });
  }),
);

// Restore an archived offer to the workspace (offerNo/documents/URLs intact).
router.post(
  '/:id/quote-offers/:offerId/unarchive',
  handle(async (req, res) => {
    const r = await unarchiveOffer(prisma, req.params.id, req.params.offerId);
    if (r.error === 'not_found') return res.status(404).json({ error: 'not_found' });
    if (r.error === 'not_archived') return res.status(409).json({ error: 'not_archived' });
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true });
  }),
);

// Exactly one primary offer per deal — and the Deal ALWAYS mirrors the primary:
// promoting an offer immediately adopts its commercial context (product/variant/
// city/participants/date/pricing headline) onto the Deal. The adoption lands in
// the Deal changelog like any other deal edit.
router.put(
  '/:id/quote-offers/:offerId/primary',
  handle(async (req, res) => {
    const before = await prisma.deal.findUnique({ where: { id: req.params.id }, select: DEAL_DIFF_SELECT });
    const r = await setPrimaryOffer(prisma, req.params.id, req.params.offerId);
    if (r.error === 'not_found') return res.status(404).json({ error: 'not_found' });
    if (r.error === 'archived') return res.status(409).json({ error: 'archived' });
    if (r.error) return res.status(400).json({ error: r.error });
    if (before && r.changed) {
      const after = await prisma.deal.findUnique({ where: { id: req.params.id }, select: DEAL_DIFF_SELECT });
      if (after) {
        await recordDealChanges(prisma, {
          dealId: req.params.id,
          before,
          after,
          origin: await userOrigin(req.adminAuth?.userId),
        });
      }
    }
    res.json({ ok: true });
  }),
);

// Send a produced quote to the customer by email (operator-reviewed text — the
// modal shows editable subject/body before this is called; nothing is auto-sent).
router.post(
  '/:id/send-quote-email',
  handle(async (req, res) => {
    const { quoteDocumentId, to, subject, body, contactId } = req.body || {};
    const doc = await prisma.quoteDocument.findUnique({ where: { id: String(quoteDocumentId || '') } });
    if (!doc || doc.dealId !== req.params.id) return res.status(404).json({ error: 'not_found' });
    if (doc.status === 'draft') return res.status(409).json({ error: 'not_produced' });
    const toAddr = String(to || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toAddr)) return res.status(422).json({ error: 'invalid_email' });
    if (!String(subject || '').trim() || !String(body || '').trim()) {
      return res.status(422).json({ error: 'missing_content' });
    }

    let sent;
    try {
      sent = await sendSimpleEmail({
        to: toAddr,
        subject: String(subject).trim(),
        bodyText: String(body),
        dealId: req.params.id,
        contactId: contactId || null,
        createdByUserId: req.adminAuth?.userId || null,
      });
    } catch (e) {
      // Provider failures answer 422 (never a 5xx that Cloudflare masks as HTML).
      return res.status(422).json({ error: 'send_failed', message: e?.message || 'send_failed' });
    }

    await emitTimelineEvent(prisma, {
      subjectType: 'deal',
      subjectId: req.params.id,
      kind: 'quote',
      data: {
        event: 'quote_sent',
        channel: 'email',
        to: toAddr,
        quoteDocumentId: doc.id,
        versionNo: doc.versionNo,
        language: doc.language,
        publicToken: doc.publicToken,
      },
      origin: await userOrigin(req.adminAuth?.userId),
    });

    res.json({ ok: true, gmailMessageId: sent.gmailMessageId, accountEmail: sent.accountEmail });
  }),
);

// ── Permanent payment URL ("קישור לתשלום") ───────────────────────────────────
// POST /:id/payment-token — ensure the deal's PERMANENT payment token exists
// and return the customer-facing URL (${PUBLIC_ORIGIN}/pay/<token>). The token
// is created once and never rotates — the customer's URL must stay stable.
// This endpoint does NOT talk to iCount: the /pay redirect generates/refreshes
// the underlying iCount link lazily when the customer opens the URL.
router.post(
  '/:id/payment-token',
  handle(async (req, res) => {
    const deal = await prisma.deal.findUnique({
      where: { id: req.params.id },
      select: { id: true, paymentToken: true },
    });
    if (!deal) return res.status(404).json({ error: 'not_found' });
    const token = await ensurePaymentToken(prisma, deal);
    res.json({ token, paymentUrl: paymentUrlFor(req, token) });
  }),
);

export default router;
