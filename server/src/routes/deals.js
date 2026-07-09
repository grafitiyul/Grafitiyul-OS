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
import { createParallelOffer, activateOffer, setPrimaryOffer, removeOrArchiveOffer, unarchiveOffer, buildWonQuoteRef } from '../quote/quoteOffers.js';
import { ensurePaymentToken, paymentUrlFor, resolvePublicOrigin } from '../dealPayment.js';
import { recordDealChanges, recordDealContactChange, DEAL_DIFF_SELECT } from '../timeline/dealChangelog.js';
import { emitTimelineEvent, userOrigin } from '../timeline/events.js';
import { sendSimpleEmail } from '../email/simpleSend.js';

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
    // Snapshot every changelog-tracked scalar (includes status/organizationId
    // used below) — the "before" side of the structured history diff.
    const existing = await prisma.deal.findUnique({
      where: { id: req.params.id },
      select: DEAL_DIFF_SELECT,
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

    const deal = await prisma.deal.update({
      where: { id: req.params.id },
      data,
      include: DEAL_INCLUDE,
    });
    // Structured changelog → Deal history (grouped per save; no-op when nothing
    // tracked actually changed). Never blocks the save itself.
    await recordDealChanges(prisma, {
      dealId: req.params.id,
      before: existing,
      after: deal,
      origin: await userOrigin(req.adminAuth?.userId),
    });
    // WON audit trail: which proposal the win was based on (or none).
    if (b.status === 'won' && existing.status !== 'won' && deal.wonQuoteRef) {
      await emitTimelineEvent(prisma, {
        subjectType: 'deal',
        subjectId: req.params.id,
        kind: 'quote',
        data: { event: 'won_reference', ...deal.wonQuoteRef },
        origin: await userOrigin(req.adminAuth?.userId),
      });
    }
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

// Exactly one primary offer per deal — what a WON deal refers to.
router.put(
  '/:id/quote-offers/:offerId/primary',
  handle(async (req, res) => {
    const r = await setPrimaryOffer(prisma, req.params.id, req.params.offerId);
    if (r.error === 'not_found') return res.status(404).json({ error: 'not_found' });
    if (r.error) return res.status(400).json({ error: r.error });
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
