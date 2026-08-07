import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { toClientLine, lineToData } from '../quote/quoteLineMapping.js';
import { normalizeBuilderVatMode } from '../../../shared/vatMode.mjs';
import { parseListQuery, containsI } from './listPagination.js';
import {
  ensureWorkingVersion,
  ensureDraftQuoteDocument,
  listDealQuoteDocuments,
  toClientQuoteDocument,
} from '../quote/quoteDocument.js';
import { createParallelOffer, activateOffer, setPrimaryOffer, removeOrArchiveOffer, unarchiveOffer, splitBuilderPatch, updateOfferContext } from '../quote/quoteOffers.js';
import { loadVatDefault, seedWorkingFromFrozen } from '../quote/importedBuilderSeed.js';
import { ensurePaymentToken, paymentUrlFor, resolvePublicOrigin, buildPaymentSnapshot, PAYMENT_DEAL_INCLUDE } from '../dealPayment.js';
import { recordDealChanges, recordDealContactChange, DEAL_DIFF_SELECT } from '../timeline/dealChangelog.js';
import { normalizeClassification } from '../deals/classification.js';
import { emitTimelineEvent, userOrigin } from '../timeline/events.js';
import { kickPayrollReconcile } from '../payroll/service.js';
import { sendSimpleEmail } from '../email/simpleSend.js';
import {
  wonGate,
  activeBookingFor,
  createTourForWonDeal,
  cancelDealBooking,
  orphanDealBooking,
  syncDealToTour,
  resyncDealGroupTours,
  pendingTourUpdate,
  copyTourStateToPlan,
  GROUP_LOCKED_FIELDS,
} from '../tours/tourFromDeal.js';
import {
  holdRegistrationForDeal,
  recordPaymentLinkOutcome,
  registerWithoutPayment,
  registerWithManualPayment,
  cancelHold,
  reconcileWaiverAfterSave,
} from '../deals/registrationCompletion.js';
import {
  loadGroupTicketLines,
  classifyBuilderChange,
  computeWaivedMinor,
  waiverBreakdown,
} from '../deals/waiver.js';
import { settleDealWonFromPayment } from '../deals/paymentWon.js';
import {
  settledPaymentStateFor,
  resolveActivityType,
  persistAssumedActivityType,
} from '../deals/resolveActivityType.js';
import { stampSettledRegistration } from '../tours/registrations.js';
import { clearPostPaymentCompletion } from '../deals/postPaymentReview.js';
import { dealDeletionBlockers, clearDeletableDealRefs } from '../deals/deleteGuard.js';
import { duplicateDeal } from '../deals/duplicateDeal.js';
import { transitionDealToWon, emitWonTransitionEffects } from '../deals/wonTransition.js';
import {
  applySilentWon,
  emitSilentWonEffects,
  resolveHistoricalWonAt,
  silentWonPlan,
} from '../deals/silentWon.js';
import { sendConfirmationEmail } from '../confirmation/sendService.js';
import { hasActiveFillers } from '../confirmation/fillers.js';
import { retryConfirmationAfterTourSetup } from '../confirmation/recovery.js';
import { wonRecoveryState } from '../deals/wonRecovery.js';
import { paymentLinkReadiness } from '../deals/paymentLinkReadiness.js';
import { resolveIssue } from '../control/issueService.js';
import { marketingDto } from '../deals/marketing.js';
import { fireCommunicationTrigger } from '../communication/engine.js';
import { fireAdminReport } from '../adminReports/dispatch.js';
import { actorForReport } from '../adminReports/actor.js';
import { sendWhatsAppText } from '../whatsapp/send.js';
import { resolveForOperator } from '../whatsapp/senderAccount.js';
import { registerDealOrderNoParam } from './dealParam.js';
import { ensureInitialCallTask } from '../tasks/autoTasks.js';

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
  // Operational GROUP count of the tour (canonical beside participants; pricing
  // consumes it). NULL = 1 group; an explicit value must be a whole number ≥ 1.
  if (b.groups !== undefined) {
    if (b.groups === null || b.groups === '') data.groups = null;
    else {
      const n = Number(b.groups);
      if (!Number.isInteger(n) || n < 1) return 'invalid_groups';
      data.groups = n;
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

// Deal ↔ Organization classification — the ONE server-side enforcement point
// (both create and update call this; the rule itself is the pure
// normalizeClassification, see ../deals/classification.js). Given the RESULTING
// link/classification (incoming value if sent, else the existing one), it
// forces the trio onto `data`: linked org ⇒ business + org's type effective
// (deal-level type force-nulled) + subtype only if it belongs to that type.
// Returns an error code when the linked organization does not exist.
async function reconcileClassification(data, resulting) {
  let orgTypeId = null;
  let subtypeTypeId = null;
  if (resulting.organizationId) {
    const org = await prisma.organization.findUnique({
      where: { id: resulting.organizationId },
      select: { organizationTypeId: true },
    });
    if (!org) return 'organization_not_found';
    orgTypeId = org.organizationTypeId;
    if (resulting.organizationSubtypeId) {
      const st = await prisma.organizationSubtype.findUnique({
        where: { id: resulting.organizationSubtypeId },
        select: { organizationTypeId: true },
      });
      subtypeTypeId = st?.organizationTypeId || null;
    }
  }
  const norm = normalizeClassification({ ...resulting, orgTypeId, subtypeTypeId });
  data.activityType = norm.activityType;
  data.organizationTypeId = norm.organizationTypeId;
  data.organizationSubtypeId = norm.organizationSubtypeId;
  return null;
}

// Deal ↔ OrganizationUnit — the unit must belong to the RESULTING linked
// organization (contacts.js enforces the same rule with the same error code).
// A unit explicitly sent with a foreign/absent org is a 400; a unit merely left
// over from a previous org link is force-cleared so an org switch can never
// strand a foreign unit on the deal.
async function reconcileUnit(data, resulting, { unitSent }) {
  if (!resulting.organizationUnitId) return null;
  if (resulting.organizationId) {
    const unit = await prisma.organizationUnit.findUnique({
      where: { id: resulting.organizationUnitId },
      select: { organizationId: true },
    });
    if (unit && unit.organizationId === resulting.organizationId) return null;
  }
  if (unitSent) return 'unit_not_in_organization';
  data.organizationUnitId = null;
  return null;
}

const CONTACT_SELECT = {
  id: true,
  contactNo: true,
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
  // The Deal's primary commercial product — the persisted mirror of the working
  // Builder's product line (written only by the Builder save path). Display
  // surfaces read THIS; there is no second product source of truth.
  product: { select: { id: true, nameHe: true, nameEn: true } },
  organization: {
    select: { id: true, orgNo: true, name: true, organizationTypeId: true, organizationType: { select: { id: true, label: true } } },
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
  // The canonical marketing/attribution record. Serialized through marketingDto
  // so the panel never sees ids, enum keys or the raw attribution bag.
  marketing: true,
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

// The deal's CURRENT group-registration state (derived from canonical
// TicketRegistrations) — drives the Deal/tour strip: held (with expiry) →
// confirmed → expired. Nothing stored; recomputed on read.
async function groupRegistrationState(dealId) {
  const regs = await prisma.ticketRegistration.findMany({
    where: { dealId, status: { in: ['held', 'confirmed', 'active', 'expired'] } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      quantity: true,
      expiresAt: true,
      tourEventId: true,
      tourEvent: { select: { id: true, date: true, startTime: true, status: true, product: { select: { nameHe: true } } } },
    },
  });
  if (!regs.length) return null;
  const held = regs.find((r) => r.status === 'held');
  const confirmed = regs.find((r) => r.status === 'confirmed' || r.status === 'active');
  const expired = regs.find((r) => r.status === 'expired');
  const current = held || confirmed || expired;
  if (!current) return null;
  return {
    state: held ? 'held' : confirmed ? 'confirmed' : 'expired',
    registrationId: current.id,
    tourEventId: current.tourEventId,
    tour: current.tourEvent,
    quantity: current.quantity,
    expiresAt: current.expiresAt,
  };
}

async function loadDeal(id) {
  const deal = await prisma.deal.findUnique({ where: { id }, include: DEAL_INCLUDE });
  if (deal && deal.activityType === 'group') {
    deal.groupRegistration = await groupRegistrationState(id);
    // Computed waiver view: the builder stays commercial (gross); the deal's
    // payable total (valueMinor) = gross − waived. Exposed so the deal UI can
    // show the waived/payable split + per-line breakdown from canonical state.
    if (deal.noPaymentWaiver) {
      const lines = await loadGroupTicketLines(prisma, id);
      const waivedMinor = computeWaivedMinor(deal.noPaymentWaiver, lines);
      const payableMinor = Number(deal.valueMinor || 0);
      deal.waiver = {
        reason: deal.noPaymentWaiver.reason || null,
        waivedAt: deal.noPaymentWaiver.waivedAt || null,
        grossMinor: payableMinor + waivedMinor,
        waivedMinor,
        payableMinor,
        breakdown: waiverBreakdown(deal.noPaymentWaiver, lines),
      };
    }
  }
  if (deal) {
    // Replace the raw row with the business-language DTO. The panel must never
    // receive leadSourceKey/attributionRaw — see the ownership map §4.6.
    deal.marketing = marketingDto(deal.marketing);
    // "WON but operationally incomplete" — the canonical recovery banner state
    // (deals/wonRecovery.js). Derived on read, like tourUpdatePending.
    deal.wonRecovery = await wonRecoveryState(prisma, deal);
    // Whether a customer-facing payment link may leave GOS unattended. Derived
    // on read like the two above; the "פתח" action ignores it by design.
    deal.paymentLinkReadiness = paymentLinkReadiness(deal);
  }
  return deal;
}

// Attach the DERIVED pending-tour-update diff (deal = desired vs tour =
// applied; see tourFromDeal.js) to a workspace deal payload. Computed on read
// from data already in DEAL_INCLUDE — nothing stored, nothing to go stale.
function withTourUpdatePending(deal) {
  if (!deal) return deal;
  const booking = (deal.bookings || []).find((bk) => bk.status === 'active') || null;
  return { ...deal, tourUpdatePending: pendingTourUpdate(deal, booking) };
}

// "מספר הזמנה" URL support — the shared resolver (routes/dealParam.js).
registerDealOrderNoParam(router, 'id');

// ---------- Deals ----------

// The non-status filter clauses (org, stage, value range, text search) shared by
// the paginated list and the status-card summary, so both honour the same
// filters and can never diverge.
function dealFilterWhere(query = {}) {
  const where = {};
  if (query.organizationId) where.organizationId = String(query.organizationId);
  if (query.stageId) where.dealStageId = String(query.stageId);
  const minVal = Number(query.minVal);
  const maxVal = Number(query.maxVal);
  if (Number.isFinite(minVal) || Number.isFinite(maxVal)) {
    where.valueMinor = {};
    if (Number.isFinite(minVal)) where.valueMinor.gte = Math.round(minVal * 100);
    if (Number.isFinite(maxVal)) where.valueMinor.lte = Math.round(maxVal * 100);
  }
  const search = String(query.search ?? query.q ?? '').trim();
  if (search) {
    const or = [{ title: containsI(search) }, { organization: { name: containsI(search) } }];
    if (/^\d+$/.test(search)) or.push({ orderNo: Number(search) });
    where.OR = or;
  }
  return where;
}

// Status-card summary: count + money SUM per status under the active filters,
// in ONE grouped query (the cards can't sum a single page, so the server does).
router.get(
  '/summary',
  handle(async (req, res) => {
    const base = dealFilterWhere(req.query);
    const grouped = await prisma.deal.groupBy({ by: ['status'], where: base, _count: { _all: true }, _sum: { valueMinor: true } });
    const out = { open: { count: 0, sumMinor: 0 }, won: { count: 0, sumMinor: 0 }, lost: { count: 0, sumMinor: 0 }, all: { count: 0, sumMinor: 0 } };
    for (const g of grouped) {
      const cell = { count: g._count._all, sumMinor: Number(g._sum.valueMinor || 0) };
      if (out[g.status]) out[g.status] = cell;
      out.all.count += cell.count;
      out.all.sumMinor += cell.sumMinor;
    }
    res.json(out);
  }),
);

// Unread-communication flags for ONE page of deals — the icons that tell an
// operator "this deal is waiting on you" without opening it.
//
// Strictly batched: 3 queries for the whole page regardless of size (deal→
// contacts, then one WhatsApp and one email lookup), never per row. Read state
// is the canonical server-side one both inboxes already maintain
// (WhatsAppChat.unreadCount/manualUnreadAt, EmailThread.unreadCount/
// manualUnread), so an icon disappears the moment that channel is read
// anywhere — in GOS, on the phone, or in Gmail.
//
// Attribution mirrors crm/conversationActivity: an EXPLICIT thread→deal link
// always counts; a contact-derived match counts only for deals that are not
// lost, so unread mail from a repeat customer cannot light up a deal that was
// closed a year ago.
async function unreadChannelsForDeals(rows) {
  const out = new Map();
  if (!rows.length) return out;
  const dealIds = rows.map((d) => d.id);
  const statusById = new Map(rows.map((d) => [d.id, d.status]));

  const links = await prisma.dealContact.findMany({
    where: { dealId: { in: dealIds } },
    select: { dealId: true, contactId: true },
  });
  const dealsByContact = new Map();
  for (const l of links) {
    if (statusById.get(l.dealId) === 'lost') continue;
    if (!dealsByContact.has(l.contactId)) dealsByContact.set(l.contactId, []);
    dealsByContact.get(l.contactId).push(l.dealId);
  }
  const contactIds = [...dealsByContact.keys()];

  const [waChats, mailThreads] = await Promise.all([
    contactIds.length
      ? prisma.whatsAppChat.findMany({
          where: {
            contactId: { in: contactIds },
            providerDeletedAt: null,
            hiddenAt: null,
            OR: [{ unreadCount: { gt: 0 } }, { manualUnreadAt: { not: null } }],
          },
          select: { contactId: true },
        })
      : [],
    prisma.emailThread.findMany({
      where: {
        OR: [
          { linkedDealId: { in: dealIds } },
          ...(contactIds.length ? [{ contactId: { in: contactIds } }] : []),
        ],
        AND: [{ OR: [{ unreadCount: { gt: 0 } }, { manualUnread: true }] }],
      },
      select: { linkedDealId: true, contactId: true },
    }),
  ]);

  const flag = (dealId, key) => {
    if (!out.has(dealId)) out.set(dealId, { unreadWhatsapp: false, unreadEmail: false });
    out.get(dealId)[key] = true;
  };
  for (const c of waChats) {
    for (const dealId of dealsByContact.get(c.contactId) || []) flag(dealId, 'unreadWhatsapp');
  }
  for (const t of mailThreads) {
    // Explicit link wins and applies whatever the deal's status is.
    if (t.linkedDealId && statusById.has(t.linkedDealId)) flag(t.linkedDealId, 'unreadEmail');
    else for (const dealId of dealsByContact.get(t.contactId) || []) flag(dealId, 'unreadEmail');
  }
  return out;
}

router.get(
  '/',
  handle(async (req, res) => {
    // The relations the list table columns read — never the heavy scalar
    // columns (notes, customerInfo, JSON blobs) the grid never shows.
    const listRelations = {
      dealStage: { select: { id: true, label: true } },
      organization: { select: { id: true, name: true } },
      organizationUnit: { select: { id: true, name: true } },
      organizationSubtype: { select: { id: true, label: true } },
      lostReasonRef: { select: { id: true, nameHe: true } },
      contacts: { where: { isPrimary: true }, take: 1, select: { contact: { select: { firstNameHe: true, lastNameHe: true, firstNameEn: true, lastNameEn: true } } } },
      _count: { select: { contacts: true } },
    };

    const { paginated, page, pageSize, skip, take } = parseListQuery(req.query);
    if (paginated) {
      const where = dealFilterWhere(req.query);
      if (req.query.status && VALID_STATUS.includes(String(req.query.status))) where.status = String(req.query.status);
      const SORTS = {
        // THE default: latest meaningful business activity (touchDealActivity
        // — timeline funnel), NOT updatedAt: mirrors/reconcilers/workers touch
        // rows without meaning anything to a person. nulls last so any
        // pre-backfill straggler sinks instead of floating.
        activity: (d) => ({ lastMeaningfulActivityAt: { sort: d, nulls: 'last' } }),
        updatedAt: (d) => ({ updatedAt: d }), createdAt: (d) => ({ createdAt: d }),
        valueMinor: (d) => ({ valueMinor: d }), orderNo: (d) => ({ orderNo: d }),
        title: (d) => ({ title: d }), expectedClose: (d) => ({ expectedCloseDate: d }),
      };
      const [sortKey, sortDir] = String(req.query.sort || 'activity:desc').split(':');
      const dir = sortDir === 'asc' ? 'asc' : 'desc';
      // Stable pagination order: sort key → createdAt → id.
      const orderBy = [(SORTS[sortKey] || SORTS.activity)(dir), { createdAt: 'desc' }, { id: 'desc' }];
      const [total, rows] = await Promise.all([
        prisma.deal.count({ where }),
        prisma.deal.findMany({
          where, orderBy, skip, take,
          select: {
            id: true, orderNo: true, title: true, status: true, valueMinor: true, currency: true,
            discountMinor: true, paymentTerms: true, source: true, expectedCloseDate: true,
            wonAt: true, lostAt: true, lostReason: true, createdAt: true, updatedAt: true,
            lastMeaningfulActivityAt: true,
            ...listRelations,
          },
        }),
      ]);
      const unread = await unreadChannelsForDeals(rows);
      return res.json({
        rows: rows.map((d) => ({ ...d, ...(unread.get(d.id) || { unreadWhatsapp: false, unreadEmail: false }) })),
        total,
        page,
        pageSize,
      });
    }

    // Legacy full-array path (pickers / cross-refs). Unchanged shape: honours
    // only status + organizationId, exactly as before.
    const legacyWhere = {};
    if (req.query.status && VALID_STATUS.includes(String(req.query.status))) legacyWhere.status = String(req.query.status);
    if (req.query.organizationId) legacyWhere.organizationId = String(req.query.organizationId);
    const deals = await prisma.deal.findMany({ where: legacyWhere, orderBy: { updatedAt: 'desc' }, include: listRelations });
    res.json(deals);
  }),
);

router.get(
  '/:id',
  handle(async (req, res) => {
    const deal = await loadDeal(req.params.id);
    if (!deal) return res.status(404).json({ error: 'not_found' });
    // Opening a deal records WHO looked and WHEN — and deliberately nothing
    // else. It must never move lastMeaningfulActivityAt (browsing is not
    // business activity; otherwise the CRM would rank by whoever scrolled
    // last), and it must never bump `updatedAt` — hence a raw UPDATE rather
    // than prisma.deal.update, whose @updatedAt would fire. Fire-and-forget:
    // a read is never delayed or failed by view bookkeeping.
    void stampDealViewed(deal.id, req.adminAuth?.userId);
    res.json(withTourUpdatePending(deal));
  }),
);

// Records the last viewer. Deliberately raw SQL: `@updatedAt` must NOT fire
// (a view is not a modification), and this is a hot path — one narrow write.
async function stampDealViewed(dealId, userId) {
  try {
    let name = null;
    if (userId) {
      const u = await prisma.adminUser.findUnique({ where: { id: userId }, select: { username: true } });
      name = u?.username || null;
    }
    await prisma.$executeRaw`
      UPDATE "Deal"
         SET "lastViewedAt" = now(),
             "lastViewedById" = ${userId || null},
             "lastViewedByName" = ${name}
       WHERE "id" = ${dealId}`;
  } catch (e) {
    console.error('[deals] stampDealViewed failed (non-fatal):', e?.message);
  }
}

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
    // Deal.organizationTypeId = this deal's classification ONLY while no
    // organization is linked; reconcileClassification below force-clears it
    // (and forces business) whenever an organization is attached.
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

    // Linked organization ⇒ business + the ORG's type is the effective type.
    const classErr = await reconcileClassification(data, {
      organizationId: data.organizationId,
      activityType: data.activityType,
      organizationTypeId: data.organizationTypeId,
      organizationSubtypeId: data.organizationSubtypeId,
    });
    if (classErr) return res.status(400).json({ error: classErr });

    const unitErr = await reconcileUnit(
      data,
      { organizationId: data.organizationId, organizationUnitId: data.organizationUnitId },
      { unitSent: b.organizationUnitId !== undefined },
    );
    if (unitErr) return res.status(400).json({ error: unitErr });

    const deal = await prisma.deal.create({ data, include: DEAL_INCLUDE });
    // Communication Center — "ליד חדש נוצר": fires ONCE per deal (idempotent
    // triggerKey deal_created:<id>); later edits never re-fire.
    fireCommunicationTrigger({ type: 'deal_created', dealId: deal.id });
    // Every new sales lead opens with exactly one "שיחה ראשונית" task
    // (idempotent; fire-and-forget by contract).
    ensureInitialCallTask({ dealId: deal.id });
    res.status(201).json(deal);
  }),
);

// Duplicate — a transactional server-side copy of the deal's COMMERCIAL
// TEMPLATE (see deals/duplicateDeal.js for exactly what copies and what never
// does). The copy is born like any new deal: OPEN, first pipeline stage, fresh
// orderNo, deal_created trigger, auto "שיחה ראשונית" task.
router.post(
  '/:id/duplicate',
  handle(async (req, res) => {
    const result = await duplicateDeal(req.params.id);
    if (result.error) {
      return res
        .status(result.error === 'not_found' ? 404 : 400)
        .json({ error: result.error });
    }
    fireCommunicationTrigger({ type: 'deal_created', dealId: result.dealId });
    ensureInitialCallTask({ dealId: result.dealId });
    const deal = await prisma.deal.findUnique({
      where: { id: result.dealId },
      include: DEAL_INCLUDE,
    });
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
      // activityTypeAssumedAt rides along so a hand-set activity type can retire
      // the pending post-payment question in the same save.
      select: {
        ...DEAL_DIFF_SELECT, productVariantId: true, orderNo: true, activityTypeAssumedAt: true,
      },
    });
    if (!existing) return res.status(404).json({ error: 'not_found' });

    const data = {};
    if (b.title !== undefined) {
      const t = String(b.title).trim();
      if (!t) return res.status(400).json({ error: 'title_required' });
      data.title = t;
    }
    // "שם הקבוצה" — dedicated business field (agent reservations); independent
    // of title by design, clearable.
    if (b.groupName !== undefined)
      data.groupName = String(b.groupName || '').trim() || null;
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
      // An operator naming the activity type IS the answer to a value the
      // system had to resolve on its own (deals/resolveActivityType.js). The
      // pending question dies with the edit — asking again through the
      // post-payment card would be asking something already answered.
      data.activityTypeAssumedAt = null;
    }
    // Deal.organizationTypeId = the deal's classification ONLY while no
    // organization is linked. reconcileClassification (below, after all fields
    // are collected) force-clears it whenever the RESULTING state has an
    // organization — the org's own type is the single effective type then.
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

    // Classification SSOT — reconcile against the RESULTING organization link
    // (sent value if present, else the existing one), so attach, replace and
    // detach all converge through the one rule: linked org ⇒ business, org's
    // type effective (deal-level copy force-nulled), subtype must belong.
    const classErr = await reconcileClassification(data, {
      organizationId:
        b.organizationId !== undefined ? data.organizationId : existing.organizationId,
      activityType:
        b.activityType !== undefined ? data.activityType : existing.activityType,
      organizationTypeId:
        b.organizationTypeId !== undefined
          ? data.organizationTypeId
          : existing.organizationTypeId,
      organizationSubtypeId:
        b.organizationSubtypeId !== undefined
          ? data.organizationSubtypeId
          : existing.organizationSubtypeId,
    });
    if (classErr) return res.status(400).json({ error: classErr });

    const unitErr = await reconcileUnit(
      data,
      {
        organizationId:
          b.organizationId !== undefined ? data.organizationId : existing.organizationId,
        organizationUnitId:
          b.organizationUnitId !== undefined
            ? data.organizationUnitId
            : existing.organizationUnitId,
      },
      { unitSent: b.organizationUnitId !== undefined },
    );
    if (unitErr) return res.status(400).json({ error: unitErr });

    // Outcome status transitions stamp/clear wonAt/lostAt. LOST now stores
    // STRUCTURED data: a required lostReasonId (FK to the LostReason catalog)
    // plus optional lostNotes. The legacy free-text `lostReason` is cleared on
    // any structured save (it only survives as a fallback on un-migrated rows).
    if (b.status !== undefined) {
      if (!VALID_STATUS.includes(b.status)) {
        return res.status(400).json({ error: 'invalid_status' });
      }
      if (b.status === 'won') {
        // WON lifecycle fields (status, FINAL pipeline stage, wonAt,
        // wonQuoteRef, lost-field clearing) are owned by the canonical
        // transition core — transitionDealToWon, called inside the
        // transaction below. Nothing WON-related goes through `data`.
      } else if (b.status === 'lost') {
        data.status = 'lost';
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
        data.status = 'open';
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

    // The ONE resolution of a missing activityType, shared with payment
    // settlement and post-payment recovery. The operator pressing WON is not a
    // reason to interpret an empty classification differently from the webhook
    // that closes the same deal a minute later — they resolve identically, and
    // the operator confirms (or corrects) it right after, on the deal.
    const wonSlot = wonTransition && b.tourEventId
      ? await prisma.tourEvent.findUnique({ where: { id: b.tourEventId }, select: { kind: true } })
      : null;
    const wonResolvedType = wonTransition
      ? resolveActivityType({ ...existing, ...data }, { groupSlotSelected: wonSlot?.kind === 'group_slot' })
      : null;

    if (wonTransition) {
      // NO draft tours: WON is refused while required fields are missing. The
      // list is declarative (requiredFields.js) — merged over this same save so
      // "fill field + WON" in one request works. activityType is absent from
      // that list by construction now: it is resolved, never demanded.
      const gate = wonGate(
        { ...existing, ...data, activityType: wonResolvedType.activityType },
        b.tourEventId,
      );
      if (gate.missing.length) {
        return res.status(422).json({
          error: 'won_requirements_missing',
          missing: gate.missing,
          activityType: wonResolvedType.activityType,
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
    // The canonical transition's outcome — wonNow decides tour creation inside
    // the tx AND the post-commit notifications; alreadyWon (a concurrent
    // winner: second tab, webhook race) silently converges with no duplicates.
    let wonOutcome = null;
    try {
      deal = await prisma.$transaction(async (tx) => {
        let updated = await tx.deal.update({
          where: { id: req.params.id },
          data,
          include: DEAL_INCLUDE,
        });
        if (wonTransition) {
          // THE canonical WON transition: atomic status guard + FINAL pipeline
          // stage + wonAt + wonQuoteRef — same core the payment paths use.
          wonOutcome = await transitionDealToWon(tx, {
            dealId: req.params.id,
            publicOrigin: resolvePublicOrigin(req),
            // Frozen into Deal.wonActor: the authenticated operator closing
            // the deal NOW — the immutable closer, not the deal's assignee.
            actorUserId: req.adminAuth?.userId || null,
            cause: 'manual',
          });
          if (wonOutcome.wonNow) {
            // Overlay the transition's lifecycle fields onto the loaded row
            // (relations from DEAL_INCLUDE stay) — the response re-reads below.
            updated = {
              ...updated,
              status: 'won',
              dealStageId: wonOutcome.deal.dealStageId,
              wonAt: wonOutcome.wonAt,
              wonQuoteRef: wonOutcome.deal.wonQuoteRef,
              lostAt: null,
              lostReasonId: null,
              lostNotes: null,
              lostReason: null,
            };
            // Same writer, same audit trail as every other path. Re-resolved
            // from the just-saved row so a type set in THIS save wins and
            // nothing is assumed over it.
            const assumedPatch = await persistAssumedActivityType(tx, {
              dealId: req.params.id,
              resolved: resolveActivityType(updated, {
                groupSlotSelected: wonSlot?.kind === 'group_slot',
              }),
              origin,
            });
            if (assumedPatch) updated = { ...updated, ...assumedPatch };
            // First WON creates (private/business) or joins (group) the tour.
            const { dealSync } = await createTourForWonDeal(tx, updated, {
              targetTourEventId: b.tourEventId,
              origin,
              allowOverbook: b.allowOverbook === true,
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
          }
        } else if (activeBooking && reopenTransition) {
          if (b.tourChoice === 'remove') {
            // Return-to-planning: BEFORE the cancel, copy the tour's
            // operational state (team/components/notes) back onto the deal's
            // DealTourPlan — a future WON recreates the tour from it. Group
            // slots are excluded (the slot and its state live on).
            if (activeBooking.tourEvent.kind !== 'group_slot') {
              const saved = await copyTourStateToPlan(tx, updated.id, activeBooking.tourEventId);
              await emitTimelineEvent(tx, {
                subjectType: 'deal',
                subjectId: updated.id,
                kind: 'tour',
                data: {
                  event: 'tour_state_saved_to_plan',
                  tourEventId: activeBooking.tourEventId,
                  ...saved,
                },
                origin,
              });
            }
            await cancelDealBooking(tx, activeBooking, { reason: 'deal_reopened', origin });
          } else {
            // 'keep' — detach path (orphan). Deliberately KEPT in the
            // architecture even though the UI currently exposes only cancel.
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
      // Capacity guard — the operator may retry with allowOverbook:true.
      if (e.code === 'tour_full') {
        return res.status(409).json({ error: 'tour_full', ...e.details });
      }
      // No active pipeline stage exists — the transition STOPS (never a
      // half-WON deal on a stale stage). Operational config error.
      if (e.code === 'no_final_stage') {
        return res.status(422).json({ error: 'no_final_stage' });
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
    // The operator just answered the classification question by hand — retire
    // the card that was going to ask it. Non-fatal: the durable answer is the
    // cleared activityTypeAssumedAt above, this only tidies the inbox.
    if (b.activityType !== undefined && existing.activityTypeAssumedAt) {
      await clearPostPaymentCompletion(prisma, req.params.id, {
        userId: req.adminAuth?.userId || null,
        userName: req.adminAuth?.userName || null,
      }).catch(() => {});
    }
    // Post-commit WON effects — Communication Center triggers + Manager Report
    // #26, fire-and-forget, exactly once: only the transaction that actually
    // flipped the status (wonNow) notifies; a concurrent duplicate does not.
    if (wonOutcome?.wonNow) {
      emitWonTransitionEffects({
        dealId: req.params.id,
        wonAt: wonOutcome.wonAt,
        cause: 'manual',
        closedByUserId: req.adminAuth?.userId || null,
        paymentAmountMinor: null,
        // Set by the Confirmation-Email preview's "הפוך ל־WON ושלח מייל אישור":
        // the operator is sending that email explicitly in the next request, so
        // the automatic hook must not also queue one.
        skipConfirmationEmail: !!req.body?.suppressConfirmationEmail,
      });
    }
    if (lostTransition) fireCommunicationTrigger({ type: 'deal_lost', dealId: req.params.id });
    // WON audit trail: which proposal the win was based on (or none).
    if (wonOutcome?.wonNow && deal.wonQuoteRef) {
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
      // AFTER the tx commits: draft payroll reconciles as a projection of the
      // new tour state (date/variant/seats all feed the engine).
      kickPayrollReconcile('tour', booking.tourEventId);

      // Communication Center — post-commit. The EFFECTIVE datetime diff:
      // before = the tour as it was, after = the deal values just applied.
      const prevDate = booking.tourEvent.date;
      const prevTime = booking.tourEvent.startTime;
      const newDate = deal.tourDate || null;
      const newTime = deal.tourTime || null;
      const datetimeChanged = (prevDate || newDate) && (prevDate !== newDate || prevTime !== newTime);
      if (datetimeChanged && newDate) {
        // "מועד הסיור השתנה" — only when a live scheduled datetime actually
        // changed (never on unrelated tour edits; postpone has no new datetime).
        fireCommunicationTrigger({
          type: 'tour_datetime_changed',
          dealId: deal.id,
          tourEventId: booking.tourEventId,
          triggerRef: `${booking.tourEventId}:${prevDate}T${prevTime || ''}->${newDate}T${newTime || ''}`,
          data: { prevDate, prevTime, newDate, newTime },
        });
      }
      if (datetimeChanged && newDate) {
        // "מועד הסיור" anchor deliveries: existing ones re-anchor via the
        // worker's re-check; this covers events configured after WON.
        fireCommunicationTrigger({ type: 'tour_datetime', dealId: deal.id });
        // Admin Report #3 — the REAL actor is the authenticated user who
        // pressed "עדכון סיור", never the deal's owner. Frozen at fire time.
        fireAdminReport({
          number: 3,
          idempotencyKey: `tour:${booking.tourEventId}:${prevDate}T${prevTime || ''}->${newDate}T${newTime || ''}`,
          dealId: deal.id,
          tourEventId: booking.tourEventId,
          data: {
            changeReport: {
              prevDate, prevTime, newDate, newTime,
              actor: await actorForReport(req.adminAuth?.userId),
            },
          },
        }).catch(() => {});
      }
    }

    // "שליחת מייל מעודכן ללקוח" (checkbox on the update banner, default on).
    // Composed only AFTER the tour update committed, so the email carries the
    // NEW canonical date/time/location/participants/duration. A failed update
    // never reaches this line, so it can never mail stale details.
    let confirmationEmail = { action: 'skipped' };
    if (pending.length && req.body?.sendUpdatedEmail) {
      const fresh = await prisma.deal.findUnique({
        where: { id: deal.id },
        select: { status: true, confirmation: { select: { fillers: true } } },
      });
      if (fresh?.status !== 'won') {
        confirmationEmail = { action: 'skipped', reason: 'deal_not_won' };
      } else if (hasActiveFillers(fresh.confirmation?.fillers)) {
        // Special terms must be read before they go out — the operator is
        // right here, so the client opens the preview.
        confirmationEmail = { action: 'preview' };
      } else {
        const out = await sendConfirmationEmail({
          dealId: deal.id,
          trigger: 'tour_update',
          actorUserId: req.adminAuth?.userId || null,
        });
        confirmationEmail = out.ok
          ? { action: 'sent', sendId: out.sendId, subject: out.subject, sendKind: out.sendKind }
          : { action: 'failed', error: out.error, warnings: out.warnings || null };
      }
    }
    res.json({ ...withTourUpdatePending(await loadDeal(deal.id)), confirmationEmail });
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
          allowOverbook: req.body?.allowOverbook === true,
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
      // Capacity guard — the operator may retry with allowOverbook:true.
      if (e.code === 'tour_full') {
        return res.status(409).json({ error: 'tour_full', ...e.details });
      }
      throw e;
    }
    if (!deal) return res.json(await loadDeal(req.params.id));
    await recordDealChanges(prisma, { dealId: req.params.id, before, after: deal, origin });
    res.json(await loadDeal(req.params.id));
  }),
);

// "השלם פרטי סיור וצור סיור" — the canonical recovery for a deal that reached
// WON without its operational tour (payment-driven WON before planning was
// complete; production #27074). Creates the missing TourEvent + Booking +
// registration through the SAME creator the WON transition uses (private/
// business builds the deal's own tour; group joins the slot in the body), then
// completes the chain: changelog, payroll reconcile, automatic confirmation-
// email retry, and resolving the בקרה issue. Fully idempotent — an existing
// active booking short-circuits tour creation, the email retry is gated by
// real-send history + the 10s duplicate window, and the issue resolve is a
// no-op once closed. Repeat clicks only re-attempt what is still incomplete.
router.post(
  '/:id/complete-tour-setup',
  handle(async (req, res) => {
    const before = await prisma.deal.findUnique({
      where: { id: req.params.id },
      select: { ...DEAL_DIFF_SELECT, productVariantId: true, orderNo: true },
    });
    if (!before) return res.status(404).json({ error: 'not_found' });
    if (before.status !== 'won') return res.status(409).json({ error: 'deal_not_won' });

    const targetTourEventId = req.body?.tourEventId ? String(req.body.tourEventId) : null;
    // ONE interpretation of a missing activityType, whichever path got here.
    // This endpoint used to refuse with a 422 while payment settlement resolved
    // and carried on — so the answer to "what kind of deal is this?" depended on
    // which button ran first. Recovery now resolves identically and never
    // blocks tour creation over a classification the system can determine.
    // Group is still only ever taken from a REAL selected slot.
    const targetTour = targetTourEventId
      ? await prisma.tourEvent.findUnique({ where: { id: targetTourEventId }, select: { kind: true } })
      : null;
    const groupSlotSelected = targetTour?.kind === 'group_slot';
    const preflight = resolveActivityType(before, { groupSlotSelected });
    const gate = wonGate({ ...before, activityType: preflight.activityType }, targetTourEventId);
    if (gate.missing.length) {
      return res.status(422).json({ error: 'won_requirements_missing', missing: gate.missing });
    }
    if (gate.needsSlot) return res.status(422).json({ error: 'tour_slot_required' });

    const origin = await userOrigin(req.adminAuth?.userId);
    let created;
    try {
      created = await prisma.$transaction(async (tx) => {
        const existing = await activeBookingFor(tx, req.params.id);
        if (existing) return { tourEventId: existing.tourEventId, already: true, after: null };
        const row = await tx.deal.findUnique({ where: { id: req.params.id } });
        // Re-resolved from the row INSIDE the transaction, not from the
        // pre-flight read: if an operator set the type in between, that choice
        // wins and nothing is assumed. TourEvent.kind comes from this value.
        const resolved = resolveActivityType(row, { groupSlotSelected });
        const assumedPatch = await persistAssumedActivityType(tx, {
          dealId: req.params.id,
          resolved,
          origin,
        });
        const full = assumedPatch ? { ...row, ...assumedPatch } : row;
        const { tourEvent, dealSync } = await createTourForWonDeal(tx, full, {
          targetTourEventId,
          origin,
          allowOverbook: req.body?.allowOverbook === true,
        });
        // The delayed half of a settlement must leave the SAME record the
        // immediate one would have: a tour that arrives minutes after the money
        // still carries a confirmed, paid seat. Evidence comes from the frozen
        // Deal.wonActor — a manually closed deal proves no payment and stamps
        // nothing, so this can never invent a payment that did not happen.
        const settled = settledPaymentStateFor(full);
        if (settled) {
          await stampSettledRegistration(tx, {
            dealId: req.params.id,
            tourEventId: tourEvent.id,
            paymentStatus: settled.paymentStatus,
          });
        }
        const after = await tx.deal.update({
          where: { id: req.params.id },
          data: dealSync || {},
        });
        // The state is repaired — the בקרה card closes in the SAME commit.
        await resolveIssue(tx, {
          dedupeKey: `won_deal_without_tour:${req.params.id}`,
          resolution: 'requirements_complete',
          resolvedBy: req.adminAuth?.userId || null,
        });
        return { tourEventId: tourEvent.id, already: false, after };
      });
    } catch (e) {
      if (e.code === 'tour_slot_invalid' || e.code === 'tour_slot_not_scheduled') {
        return res.status(422).json({ error: e.code });
      }
      if (e.code === 'tour_full') {
        return res.status(409).json({ error: 'tour_full', ...e.details });
      }
      throw e;
    }

    if (!created.already) {
      await recordDealChanges(prisma, {
        dealId: req.params.id, before, after: created.after, origin,
      });
      // Draft payroll reconciles as a projection of the new tour (post-commit,
      // the apply-tour-update convention).
      kickPayrollReconcile('tour', created.tourEventId);
    }
    // Chain completion: the confirmation email. Runs on EVERY call (not only
    // when the tour was just created) so a click that follows a half-finished
    // earlier attempt still finishes the chain.
    const confirmationEmail = await retryConfirmationAfterTourSetup({
      dealId: req.params.id,
      actorUserId: req.adminAuth?.userId || null,
    });
    res.json({ ...withTourUpdatePending(await loadDeal(req.params.id)), confirmationEmail });
  }),
);

// Confirm (or correct) a classification the system resolved when a payment
// closed the deal before anyone chose one — the answer to the post-payment
// completion card.
//
// Confirming is not a no-op write: activityTypeAssumedAt is what makes the Deal
// say "nobody has looked at this yet", so clearing it IS the operator's answer.
// Correcting goes through the normal classification path so the org rule still
// governs (an org-linked deal cannot be talked into 'private' here).
// Idempotent: a deal with nothing assumed returns ok and changes nothing.
router.post(
  '/:id/confirm-classification',
  handle(async (req, res) => {
    const before = await prisma.deal.findUnique({
      where: { id: req.params.id },
      select: { ...DEAL_DIFF_SELECT, activityTypeAssumedAt: true, organizationId: true, orderNo: true },
    });
    if (!before) return res.status(404).json({ error: 'not_found' });

    const chosen = req.body?.activityType ? String(req.body.activityType) : null;
    if (chosen && !VALID_ACTIVITY_TYPES.includes(chosen)) {
      return res.status(400).json({ error: 'invalid_activity_type' });
    }
    // The org rule is canonical and outranks a hand-picked value here: an
    // org-linked deal is business, full stop (deals/classification.js).
    if (chosen && chosen !== 'business' && before.organizationId) {
      return res.status(409).json({ error: 'organization_forces_business' });
    }

    const origin = await userOrigin(req.adminAuth?.userId);
    const after = await prisma.deal.update({
      where: { id: req.params.id },
      data: {
        ...(chosen ? { activityType: chosen } : {}),
        activityTypeAssumedAt: null,
      },
    });
    await recordDealChanges(prisma, { dealId: req.params.id, before, after, origin });
    await clearPostPaymentCompletion(prisma, req.params.id, {
      userId: req.adminAuth?.userId || null,
      userName: req.adminAuth?.userName || null,
    });
    res.json(withTourUpdatePending(await loadDeal(req.params.id)));
  }),
);

// ── "הפוך ל-WON שקט" — the historical WON correction ────────────────────────
//
// A deal that really happened and was really paid years ago, but was never
// closed in the CRM. This is NOT the WON button: it changes the lifecycle
// status (plus an OPTIONAL tour and an OPTIONAL confirmation email) and
// nothing else. No customer/manager notifications fire, and no payment,
// accounting document or collection state is created, implied or changed —
// see deals/silentWon.js for the full contract.
//
// GET returns the plan (what would happen) so the dialog can show it before
// the operator commits; POST performs it.
router.get(
  '/:id/silent-won/plan',
  handle(async (req, res) => {
    const deal = await prisma.deal.findUnique({ where: { id: req.params.id } });
    if (!deal) return res.status(404).json({ error: 'not_found' });
    const activeBooking = await activeBookingFor(prisma, deal.id);
    res.json({
      ...silentWonPlan(deal, { createTour: false, tourEventId: null }),
      tourDate: deal.tourDate,
      tourTime: deal.tourTime,
      activityType: deal.activityType,
      // "Would creating a tour duplicate reality?" — the honest answer the
      // dialog needs, computed from live state rather than assumed.
      hasActiveBooking: !!activeBooking,
      alreadyHistoricallyCorrected: !!deal.historicalWonAt,
    });
  }),
);

router.post(
  '/:id/silent-won',
  handle(async (req, res) => {
    const before = await prisma.deal.findUnique({
      where: { id: req.params.id },
      select: { ...DEAL_DIFF_SELECT, productVariantId: true, orderNo: true, historicalWonAt: true },
    });
    if (!before) return res.status(404).json({ error: 'not_found' });
    if (before.status === 'won') return res.status(409).json({ error: 'deal_already_won' });

    const resolved = resolveHistoricalWonAt({
      mode: req.body?.wonDateMode === 'custom' ? 'custom' : 'today',
      date: req.body?.wonDate ? String(req.body.wonDate) : null,
    });
    if (resolved.error) return res.status(422).json({ error: resolved.error });

    const createTour = req.body?.createTour === true;
    const tourEventId = req.body?.tourEventId ? String(req.body.tourEventId) : null;
    const emailRequested = req.body?.sendConfirmationEmail === true;

    // A tour is created only through the canonical path, with the canonical
    // planning requirements. Refusing up front beats a half-applied correction.
    if (createTour) {
      const full = await prisma.deal.findUnique({ where: { id: req.params.id } });
      const gate = wonGate(full, tourEventId);
      if (gate.missing.length) {
        return res.status(422).json({ error: 'won_requirements_missing', missing: gate.missing });
      }
      if (gate.needsSlot) return res.status(422).json({ error: 'tour_slot_required' });
    }

    const origin = await userOrigin(req.adminAuth?.userId);
    let outcome;
    try {
      outcome = await prisma.$transaction(async (tx) => {
        const full = await tx.deal.findUnique({ where: { id: req.params.id } });
        return applySilentWon(tx, {
          deal: full,
          wonAt: resolved.at,
          createTour,
          tourEventId,
          emailRequested,
          actorUserId: req.adminAuth?.userId || null,
          origin,
        });
      });
    } catch (e) {
      if (e.code === 'tour_slot_invalid' || e.code === 'tour_slot_not_scheduled') {
        return res.status(422).json({ error: e.code });
      }
      if (e.code === 'tour_full') return res.status(409).json({ error: 'tour_full', ...e.details });
      throw e;
    }

    // A retry that found the deal already WON changes nothing and says so.
    if (!outcome.wonNow) return res.status(409).json({ error: 'deal_already_won' });

    const after = await loadDeal(req.params.id);
    await recordDealChanges(prisma, { dealId: req.params.id, before, after, origin });
    // The human-readable audit line, beside the structured field diff: WHO
    // performed the correction and exactly WHICH choices they made.
    await emitTimelineEvent(prisma, {
      subjectType: 'deal',
      subjectId: req.params.id,
      kind: 'change',
      data: {
        title: 'תיקון היסטורי — הפיכה ל-WON שקט',
        changes: [
          { fieldKey: 'silentWonReason', labelHe: 'סיבה', newDisplay: 'תיקון היסטורי (הדיל כבר התרחש)' },
          { fieldKey: 'silentWonPrevStatus', labelHe: 'סטטוס קודם', newDisplay: outcome.note.previousStatus },
          { fieldKey: 'silentWonAt', labelHe: 'תאריך WON שנבחר', newDisplay: outcome.note.wonAt.slice(0, 10) },
          { fieldKey: 'silentWonEmail', labelHe: 'מייל אישור', newDisplay: emailRequested ? 'נשלח' : 'לא נשלח' },
          { fieldKey: 'silentWonTour', labelHe: 'סיור', newDisplay: outcome.tour ? 'נוצר סיור' : 'לא נוצר סיור (תיקון היסטורי מכוון)' },
          { fieldKey: 'silentWonMoney', labelHe: 'תשלומים ומסמכים', newDisplay: 'לא בוצע שינוי' },
        ],
      },
      origin,
    });

    emitSilentWonEffects({
      dealId: req.params.id,
      wonAt: outcome.wonAt,
      emailRequested,
      closedByUserId: req.adminAuth?.userId || null,
    });
    if (outcome.tour) kickPayrollReconcile('tour', outcome.tour.id);

    res.json(withTourUpdatePending(after));
  }),
);

// ── Group registration completion (the progressive modal's server actions) ───
// All idempotent, all on the shipped lifecycle primitives. A group deal only.
async function requireGroupDeal(req, res) {
  const deal = await prisma.deal.findUnique({
    where: { id: req.params.id },
    select: { id: true, activityType: true, status: true, participants: true, productVariantId: true, productId: true, paymentToken: true },
  });
  if (!deal) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  if (deal.activityType !== 'group') {
    res.status(409).json({ error: 'not_group_deal' });
    return null;
  }
  return deal;
}

// The deal's STABLE customer payment URL — the permanent GOS token link
// (${PUBLIC_ORIGIN}/payment/icount/<token>) the send-link/pay-now flows embed.
// It is generated once and never changes; the iCount sale link is created
// lazily when the customer opens it (routes/payment.js). No Deal state changes.
async function dealPaymentUrl(req, deal) {
  const token = await ensurePaymentToken(prisma, deal);
  return paymentUrlFor(req, token);
}

router.post(
  '/:id/register/payment-url',
  handle(async (req, res) => {
    const deal = await requireGroupDeal(req, res);
    if (!deal) return;
    res.json({ paymentUrl: await dealPaymentUrl(req, deal) });
  }),
);

// Create / extend a HELD reservation (used by pay-now and send-link). Returns the
// stable payment URL so pay-now can open the real payment page immediately. The
// Deal stays OPEN — settlement to WON happens only on a verified provider payment.
router.post(
  '/:id/register/hold',
  handle(async (req, res) => {
    const deal = await requireGroupDeal(req, res);
    if (!deal) return;
    const b = req.body || {};
    if (!b.tourEventId) return res.status(400).json({ error: 'tour_event_required' });
    const origin = await userOrigin(req.adminAuth?.userId);
    const result = await holdRegistrationForDeal(prisma, {
      dealId: deal.id,
      tourEventId: String(b.tourEventId),
      productVariantId: b.productVariantId ?? deal.productVariantId ?? null,
      priceRuleId: b.priceRuleId ?? null,
      cardGroupId: b.cardGroupId ?? null,
      quantity: Number(b.quantity) || Number(deal.participants) || 1,
      value: b.value,
      unit: b.unit,
      origin,
    });
    const paymentUrl = await dealPaymentUrl(req, deal).catch(() => null);
    res.json({ ...result, paymentUrl, deal: await loadDeal(req.params.id) });
  }),
);

// Send-payment-link: hold the seat, ensure the REAL payment URL is in the
// message, SEND it through the real WhatsApp bridge, and record the exact
// outcome (sent / failed) in the Deal timeline. Never claims success on a failed
// send — the hold is still created so the operator can retry. Deal stays OPEN.
router.post(
  '/:id/register/send-link',
  handle(async (req, res) => {
    const deal = await requireGroupDeal(req, res);
    if (!deal) return;
    const b = req.body || {};
    if (!b.tourEventId) return res.status(400).json({ error: 'tour_event_required' });
    // Phone: trust the client's, else resolve the canonical payment-link contact
    // phone from the deal (SAME rule as the payment snapshot).
    let phone = String(b.phone || '').trim();
    if (!phone) {
      const full = await prisma.deal.findUnique({ where: { id: deal.id }, include: PAYMENT_DEAL_INCLUDE });
      phone = String(buildPaymentSnapshot(full).customerPhone || '').trim();
    }
    if (!phone) return res.status(400).json({ error: 'phone_required' });
    const origin = await userOrigin(req.adminAuth?.userId);
    // 1) Idempotent hold (re-send extends the same hold).
    const held = await holdRegistrationForDeal(prisma, {
      dealId: deal.id,
      tourEventId: String(b.tourEventId),
      productVariantId: b.productVariantId ?? deal.productVariantId ?? null,
      priceRuleId: b.priceRuleId ?? null,
      cardGroupId: b.cardGroupId ?? null,
      quantity: Number(b.quantity) || Number(deal.participants) || 1,
      value: b.value,
      unit: b.unit,
      origin,
    });
    // 2) The real stable payment URL — guaranteed present in the outgoing text
    //    (append if the edited message dropped it) so no empty placeholder ships.
    const paymentUrl = await dealPaymentUrl(req, deal);
    let message = String(b.message || '').trim();
    if (!message.includes(paymentUrl)) message = message ? `${message}\n${paymentUrl}` : paymentUrl;
    // 3) Real WhatsApp send. Idempotency keyed on the registration so a retried
    //    request can't double-send the same link.
    let sent = false;
    let externalMessageId = null;
    let failureReason = null;
    try {
      // Explicit account: the number the operator picked in the UI, never a
      // fallback. `remember` is deliberately off — the choice is remembered in
      // that operator's BROWSER (several employees share one GOS login and
      // each works from a different number), so the server must not write a
      // per-user preference that would move everyone else's selection.
      const sender = await resolveForOperator(prisma, {
        userId: req.adminAuth?.userId || null,
        explicit: b.accountId || null,
      });
      const out = await sendWhatsAppText(phone, message, {
        accountId: sender.accountId,
        idempotencyKey: `paylink-${held.registration.id}`,
      });
      sent = true;
      externalMessageId = out.externalMessageId;
    } catch (e) {
      failureReason = e?.code || 'send_failed';
    }
    // 4) Record the exact outcome (sent OR failed) with the message + URL.
    await recordPaymentLinkOutcome(prisma, {
      dealId: deal.id,
      tourEventId: String(b.tourEventId),
      registrationId: held.registration.id,
      message,
      phone,
      paymentLink: paymentUrl,
      sent,
      externalMessageId,
      failureReason,
      origin,
    });
    const payload = { ...held, paymentUrl, sent, externalMessageId, failureReason, deal: await loadDeal(req.params.id) };
    // Honest status: a failed send is a 502 (hold kept), so the UI never shows
    // "sent" when the message didn't leave.
    if (!sent) return res.status(502).json(payload);
    res.json(payload);
  }),
);

// Register WITHOUT payment: reason required → confirm + WON.
router.post(
  '/:id/register/no-payment',
  handle(async (req, res) => {
    const deal = await requireGroupDeal(req, res);
    if (!deal) return;
    const b = req.body || {};
    if (!b.tourEventId) return res.status(400).json({ error: 'tour_event_required' });
    const origin = await userOrigin(req.adminAuth?.userId);
    // Snapshot for the changelog: register-without-payment zeroes the total, so
    // the value change (X → 0) is recorded via the canonical diff path.
    const before = await prisma.deal.findUnique({ where: { id: deal.id }, select: DEAL_DIFF_SELECT });
    try {
      await registerWithoutPayment(prisma, {
        dealId: deal.id,
        tourEventId: String(b.tourEventId),
        reason: b.reason,
        allowOverbook: b.allowOverbook === true,
        origin,
      });
    } catch (e) {
      if (e.code === 'no_payment_reason_required') return res.status(422).json({ error: e.code });
      if (e.code === 'tour_full') return res.status(409).json({ error: 'tour_full', ...e.details });
      if (e.code === 'tour_slot_invalid' || e.code === 'tour_slot_not_scheduled') {
        return res.status(422).json({ error: e.code });
      }
      throw e;
    }
    const after = await prisma.deal.findUnique({ where: { id: deal.id }, select: DEAL_DIFF_SELECT });
    if (before && after) await recordDealChanges(prisma, { dealId: deal.id, before, after, origin });
    res.json(await loadDeal(req.params.id));
  }),
);

// Register with a MANUAL payment (paid outside GOS) — two explicit modes:
// 'record' (the atomic document-first flow: called ONLY after the accounting
// document was successfully issued; the document id is verified against the
// deal and the invrec is the money record) or 'external_approved' (attested
// paid/approved outside the system, no payment details — never labeled
// "free"). The commercial total is NEVER zeroed. WON exactly once via the
// canonical transition, and only AFTER the document exists.
router.post(
  '/:id/register/manual-payment',
  handle(async (req, res) => {
    const deal = await requireGroupDeal(req, res);
    if (!deal) return;
    const b = req.body || {};
    if (!b.tourEventId) return res.status(400).json({ error: 'tour_event_required' });
    const origin = await userOrigin(req.adminAuth?.userId);
    try {
      const result = await registerWithManualPayment(prisma, {
        dealId: deal.id,
        tourEventId: String(b.tourEventId),
        mode: b.mode,
        method: b.method || null,
        icountDocumentId: b.icountDocumentId || null,
        paidAt: b.paidAt || null,
        note: b.note || null,
        allowOverbook: b.allowOverbook === true,
        userId: req.adminAuth?.userId || null,
        origin,
      });
      res.json({ alreadyWon: !!result.alreadyWon, deal: await loadDeal(req.params.id) });
    } catch (e) {
      if (['invalid_manual_mode', 'document_required', 'invalid_method', 'date_invalid'].includes(e.code)) {
        return res.status(422).json({ error: e.code });
      }
      if (e.code === 'tour_full') return res.status(409).json({ error: 'tour_full', ...e.details });
      if (e.code === 'tour_slot_invalid' || e.code === 'tour_slot_not_scheduled') {
        return res.status(422).json({ error: e.code });
      }
      throw e;
    }
  }),
);

// Cancel the deal's active held reservation.
router.post(
  '/:id/register/cancel-hold',
  handle(async (req, res) => {
    const deal = await requireGroupDeal(req, res);
    if (!deal) return;
    await cancelHold(prisma, { dealId: deal.id, origin: await userOrigin(req.adminAuth?.userId) });
    res.json(await loadDeal(req.params.id));
  }),
);

// Verified-payment settlement (pay-now callback) → canonical WON.
router.post(
  '/:id/register/settle-payment',
  handle(async (req, res) => {
    const deal = await requireGroupDeal(req, res);
    if (!deal) return;
    const origin = await userOrigin(req.adminAuth?.userId);
    try {
      await settleDealWonFromPayment(prisma, {
        dealId: deal.id,
        allowOverbook: req.body?.allowOverbook === true,
        origin,
      });
    } catch (e) {
      if (e.code === 'tour_full') return res.status(409).json({ error: 'tour_full', ...e.details });
      throw e;
    }
    res.json(await loadDeal(req.params.id));
  }),
);

router.delete(
  '/:id',
  handle(async (req, res) => {
    // Deletion is blocked by LIVE dependencies only — an active/orphaned
    // booking, held seats, or accounting records (deals/deleteGuard.js). A
    // CANCELLED booking is history: it holds no seat, no tour and no money, and
    // refusing over it made a correctly-reopened deal permanently undeletable.
    const blockers = await dealDeletionBlockers(prisma, req.params.id);
    if (blockers.length) {
      return res.status(409).json({ error: 'deal_not_deletable', blockers });
    }
    // Cancelled bookings cannot be orphaned (non-null dealId + ON DELETE
    // RESTRICT), so they are cleared through the canonical path in the SAME
    // transaction as the delete. The tour's timeline and the cancelled
    // registration keep the audit trail. Everything else cascades or nulls out.
    await prisma.$transaction(async (tx) => {
      await clearDeletableDealRefs(tx, req.params.id, {
        actorUserId: req.adminAuth?.userId || null,
        actorName: req.adminAuth?.userName || null,
      });
      await tx.deal.delete({ where: { id: req.params.id } });
    });
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
    const deal = await prisma.deal.findUnique({ where: { id: req.params.id }, select: { id: true, valueMinor: true } });
    if (!deal) return res.status(404).json({ error: 'not_found' });
    // `created` lets the client seed a default line for a brand-new deal while
    // letting an existing deal legitimately have zero lines (user deleted them).
    let version = await prisma.quoteVersion.findFirst({ where: { dealId: req.params.id, isWorking: true } });
    let created = false;

    if (!version) {
      // A MIGRATED deal has no working version — its commercial record is the
      // frozen Pipedrive import. Minting an empty working version here (which is
      // what this route used to do on a mere READ) produced the empty Builder on
      // 8,010 historical deals: the blank new version became the deal's quote and
      // hid the imported one. A read must not create commercial state.
      //
      // So: surface the frozen version READ-ONLY instead. The deal keeps no
      // working version until someone deliberately starts one, which is what
      // keeps 15,689 imported versions historical evidence rather than live
      // editable quotes.
      const frozen = await prisma.quoteVersion.findFirst({
        where: {
          dealId: req.params.id,
          isWorking: false,
          lines: { some: { active: true } },
        },
        orderBy: [{ sourceKind: 'asc' }, { createdAt: 'desc' }],
      });
      if (frozen) {
        const lines = await prisma.quoteLine.findMany({
          where: { quoteVersionId: frozen.id },
          orderBy: { sortOrder: 'asc' },
        });
        return res.json({
          versionId: frozen.id,
          created: false,
          readOnly: true,
          // Read-only is a VIEW, never a permanent lock: the client offers an
          // explicit "start editing" action (POST /price-lines/start-editing)
          // that seeds a working copy while this frozen record stays evidence.
          canStartEditing: true,
          mode: 'historical_import',
          source: frozen.sourceKind || 'import',
          importedAt: frozen.createdAt,
          vatMode: frozen.vatMode || null,
          lines: lines.map(toClientLine),
        });
      }
      version = await prisma.quoteVersion.create({ data: { dealId: req.params.id, isWorking: true, status: 'draft' } });
      created = true;
    }

    const lines = await prisma.quoteLine.findMany({
      where: { quoteVersionId: version.id },
      orderBy: { sortOrder: 'asc' },
    });

    // A deal whose working version is EMPTY but which HAS an imported record is
    // the same story seen one step later (the blank version already exists, from
    // before this route stopped creating them). Show the history rather than a
    // blank sheet — the working version stays untouched and takes over the moment
    // it has a line of its own.
    //
    // "Empty" means ZERO lines — not "no active line". A working version whose
    // lines were all toggled inactive is operator work in progress; falling back
    // to the frozen view here used to trap it read-only with no way back.
    if (lines.length === 0) {
      const frozen = await prisma.quoteVersion.findFirst({
        where: { dealId: req.params.id, isWorking: false, lines: { some: { active: true } } },
        orderBy: [{ sourceKind: 'asc' }, { createdAt: 'desc' }],
      });
      if (frozen) {
        const frozenLines = await prisma.quoteLine.findMany({
          where: { quoteVersionId: frozen.id },
          orderBy: { sortOrder: 'asc' },
        });
        return res.json({
          versionId: frozen.id,
          workingVersionId: version.id,
          created: false,
          readOnly: true,
          canStartEditing: true,
          mode: 'historical_import',
          source: frozen.sourceKind || 'import',
          importedAt: frozen.createdAt,
          vatMode: frozen.vatMode || null,
          lines: frozenLines.map(toClientLine),
        });
      }
    }

    // The order-level VAT mode travels WITH the lines — it is what they mean.
    // The deal-discount INTENT (summary row) rides along the same way; the
    // resolved money is one of the lines (sourceKind 'deal_discount').
    res.json({
      versionId: version.id,
      created,
      vatMode: version.vatMode || null,
      dealDiscountPercent: version.dealDiscountPercent ?? null,
      dealDiscountFixedMinor:
        version.dealDiscountFixedMinor != null ? Number(version.dealDiscountFixedMinor) : null,
      lines: lines.map(toClientLine),
    });
  }),
);

// EXPLICIT operator action: make this deal's Builder editable. This is the ONE
// deliberate write that GET deliberately refuses to perform — reads stay
// side-effect free, and becoming editable is an operator decision.
//
// Universal-editability invariant: EVERY deal can enter an editable working
// state. The frozen historical version (when one exists) is copied verbatim
// into a working version through the shared seeding mechanism
// (quote/importedBuilderSeed.js — the same path the unpaid-unlock runner uses);
// with no evidence at all the deal simply gets an empty working version.
//
// Never: mutates a frozen version, marks it working, overwrites a working
// version that already has lines (re-checked in-transaction), touches
// Deal fields / tours / registrations / timeline / lastMeaningfulActivityAt.
router.post(
  '/:id/price-lines/start-editing',
  handle(async (req, res) => {
    const deal = await prisma.deal.findUnique({
      where: { id: req.params.id },
      select: { id: true, valueMinor: true },
    });
    if (!deal) return res.status(404).json({ error: 'not_found' });
    const vatDefault = await loadVatDefault(prisma);
    const result = await seedWorkingFromFrozen(prisma, deal, {
      vatDefault,
      execute: true,
      // Operator mode: seed as-imported even when no VAT interpretation
      // reproduces Deal.valueMinor (the operator is about to review the lines),
      // and even when the deal has no agreed amount.
      allowUnproven: true,
      auditContext: { rule: 'operator_start_editing', by: req.adminAuth?.userId || null },
    });
    if (result.outcome === 'no_evidence') {
      // No frozen commercial evidence — an empty editable Builder is the honest
      // starting point. Nothing is invented.
      await ensureWorkingVersion(prisma, req.params.id);
    }
    res.json({ ok: true, outcome: result.outcome, unverified: result.unverified || false });
  }),
);

// READ-ONLY historical commercial breakdown imported from Pipedrive. Returns the
// frozen pipedrive_import version (never the working version); the builder opens
// it read-only with a banner. No writes, no engine, no side effects.
router.get(
  '/:id/price-lines/historical',
  handle(async (req, res) => {
    const deal = await prisma.deal.findUnique({ where: { id: req.params.id }, select: { id: true, valueMinor: true } });
    if (!deal) return res.status(404).json({ error: 'not_found' });
    const version = await prisma.quoteVersion.findFirst({
      where: { dealId: req.params.id, sourceKind: 'pipedrive_import' },
      orderBy: { createdAt: 'asc' },
    });
    if (!version) return res.json({ exists: false });
    const [lines, xwalk] = await Promise.all([
      prisma.quoteLine.findMany({ where: { quoteVersionId: version.id }, orderBy: { sortOrder: 'asc' } }),
      prisma.legacyRecord.findFirst({ where: { entityType: 'QuoteVersion', entityId: version.id }, select: { cardData: true } }),
    ]);
    res.json({
      exists: true,
      versionId: version.id,
      readOnly: true,
      source: 'pipedrive',
      importedAt: version.createdAt,
      reconciliation: xwalk?.cardData ?? null,
      lines: lines.map(toClientLine),
    });
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
    const origin = await userOrigin(req.adminAuth?.userId);

    // INVARIANT — at most ONE primary product line per working version.
    // Two non-frozen `kind:'product'` lines double-count the engine base price
    // (builderCompose prices each from the same product resolution). Frozen
    // agent-reservation lines are exempt: a reservation legitimately snapshots
    // several accepted base rows as product lines, all `overridden`, never
    // engine-priced. Group-ticket builders carry zero product lines and are
    // unaffected.
    const primaryCount = rows.filter((r) => r.kind === 'product' && r.sourceKind !== 'agent_reservation').length;
    if (primaryCount > 1) {
      return res.status(422).json({ error: 'multiple_primary_products' });
    }

    // WAIVER pre-check: a deal registered without payment carries a canonical
    // waiver. Editing that keeps the builder commercial, but an INCREASE (more of
    // an existing ticket, or a new card/ticket) is an ambiguous business decision
    // the system must never resolve silently — refuse until the operator chooses.
    const waiverRow = await prisma.deal.findUnique({ where: { id: req.params.id }, select: { noPaymentWaiver: true } });
    const waiver = waiverRow?.noPaymentWaiver || null;
    if (waiver && !b.waiverDecision) {
      const oldLines = await loadGroupTicketLines(prisma, req.params.id);
      const newLines = inputLines
        .filter((l) => l.sourceKind === 'group_ticket')
        // carry the builder line's combined label ("card — ticket") so the client
        // decision dialog can name the newly-added tickets.
        .map((l) => ({ cardGroupId: l.sourceCardGroupId || null, ticketTypeId: l.ticketTypeId || null, quantity: Number(l.quantity) || 0, cardTitle: l.label || null }));
      const change = classifyBuilderChange(oldLines, newLines);
      if (change.hasIncrease) {
        return res.status(409).json({ error: 'waiver_decision_required', added: change.added });
      }
    }

    const versionId = await prisma.$transaction(async (tx) => {
      const version = await ensureWorkingVersion(tx, req.params.id);
      // The order-level VAT mode is saved WITH the lines, in the same
      // transaction: the amounts and their interpretation can never be
      // persisted apart, so a reload always reads back the same money.
      const nextVatMode = normalizeBuilderVatMode(b.vatMode);
      // Deal-discount INTENT — normalized to at most ONE positive value
      // (percent wins when both somehow arrive). Saved with the lines in the
      // same transaction, exactly like vatMode: the resolved discount line and
      // the intent that produced it can never be persisted apart.
      const pctRaw = Number(b.dealDiscountPercent);
      const fixedRaw = Number(b.dealDiscountFixedMinor);
      const nextPct = Number.isFinite(pctRaw) && pctRaw > 0 && pctRaw <= 100 ? pctRaw : null;
      const nextFixed =
        nextPct == null && Number.isFinite(fixedRaw) && fixedRaw > 0
          ? BigInt(Math.round(fixedRaw))
          : null;
      await tx.quoteVersion.update({
        where: { id: version.id },
        data: {
          vatMode: nextVatMode,
          dealDiscountPercent: nextPct,
          dealDiscountFixedMinor: nextFixed,
        },
      });
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
      if (Object.keys(dealPatch).length) {
        await tx.deal.update({ where: { id: req.params.id }, data: dealPatch });
      }
      if (Object.keys(offerPatch).length) await tx.quoteOffer.update({ where: { id: offer.id }, data: offerPatch });
      // A builder edit must IMMEDIATELY re-derive the tour's operational product
      // for every registration this deal already has — a WON booking OR a still-
      // open held reservation (which the old booking-only path missed). ONE
      // canonical resync + recompute; runs after the new lines are written so the
      // offering resolves from the current cards.
      await resyncDealGroupTours(tx, req.params.id, { origin });

      // WAIVER reconciliation — the ONE canonical recompute (waiver evolves with
      // the builder; valueMinor = gross − waived). `b.valueMinor` is the builder's
      // commercial gross; the reconcile overrides valueMinor with the payable.
      if (waiver) {
        await reconcileWaiverAfterSave(tx, {
          dealId: req.params.id,
          waiver,
          grossMinor: Number(b.valueMinor) || 0,
          decision: b.waiverDecision,
          origin,
        });
      }
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
    res.json({ versionId, vatMode: normalizeBuilderVatMode(b.vatMode), lines: lines.map(toClientLine) });
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
