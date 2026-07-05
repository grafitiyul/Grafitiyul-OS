import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { toClientLine, lineToData } from '../quote/quoteLineMapping.js';
import {
  ensureWorkingVersion,
  ensureDraftQuoteDocument,
  toClientQuoteDocument,
} from '../quote/quoteDocument.js';

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
};

async function loadDeal(id) {
  return prisma.deal.findUnique({ where: { id }, include: DEAL_INCLUDE });
}

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
    res.json(deal);
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
    const existing = await prisma.deal.findUnique({
      where: { id: req.params.id },
      select: { status: true, organizationId: true },
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

    const deal = await prisma.deal.update({
      where: { id: req.params.id },
      data,
      include: DEAL_INCLUDE,
    });
    res.json(deal);
  }),
);

router.delete(
  '/:id',
  handle(async (req, res) => {
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
    res.json(await loadDeal(link.dealId));
  }),
);

router.delete(
  '/contacts/:linkId',
  handle(async (req, res) => {
    const link = await prisma.dealContact.findUnique({
      where: { id: req.params.linkId },
    });
    if (!link) return res.status(404).json({ error: 'not_found' });
    await prisma.dealContact.delete({ where: { id: link.id } });
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
    const deal = await prisma.deal.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!deal) return res.status(404).json({ error: 'not_found' });
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
      // Deal headline cache + the operational product/city this was priced against.
      const dealPatch = {};
      if (b.valueMinor !== undefined) dealPatch.valueMinor = BigInt(Math.round(Number(b.valueMinor) || 0));
      if (b.productId !== undefined) dealPatch.productId = b.productId || null;
      if (b.productVariantId !== undefined) dealPatch.productVariantId = b.productVariantId || null;
      // A product change inside the builder carries its city too, so the Deal stays
      // coherent (same product → variant → city resolution as the Tour Details card).
      if (b.locationId !== undefined) dealPatch.locationId = b.locationId || null;
      // Group Ticket Builder derives the headcount from ticket quantities — the Deal
      // participants follow the tickets (one source of truth) and are read-only in
      // the panel. Only the Group builder sends this; other callers leave it alone.
      if (b.participants !== undefined) {
        const n = parseInt(b.participants, 10);
        dealPatch.participants = Number.isFinite(n) && n >= 0 ? n : null;
      }
      if (Object.keys(dealPatch).length) await tx.deal.update({ where: { id: req.params.id }, data: dealPatch });
      return version.id;
    });

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

export default router;
