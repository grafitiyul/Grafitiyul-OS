import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

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
const VALID_ROLES = [
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

const CONTACT_SELECT = {
  id: true,
  firstNameHe: true,
  lastNameHe: true,
  firstNameEn: true,
  lastNameEn: true,
  phones: { where: { isPrimary: true }, take: 1 },
  emails: { where: { isPrimary: true }, take: 1 },
};

const DEAL_INCLUDE = {
  dealStage: true,
  organization: { select: { id: true, name: true } },
  organizationUnit: { select: { id: true, name: true } },
  organizationSubtype: { select: { id: true, label: true } },
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

    const deal = await prisma.deal.create({
      data: {
        title,
        dealStageId,
        status: 'open',
        organizationId: b.organizationId || null,
        organizationUnitId: b.organizationUnitId || null,
        organizationSubtypeId: b.organizationSubtypeId || null,
        valueMinor: toMinor(b.valueMinor) ?? 0n,
        currency: b.currency ? String(b.currency).trim() : 'ILS',
        discountMinor: toMinor(b.discountMinor),
        paymentTerms: b.paymentTerms ? String(b.paymentTerms).trim() : null,
        source: b.source ? String(b.source).trim() : null,
        expectedCloseDate: b.expectedCloseDate
          ? new Date(b.expectedCloseDate)
          : null,
        notes: b.notes ? String(b.notes).trim() : null,
      },
      include: DEAL_INCLUDE,
    });
    res.status(201).json(deal);
  }),
);

router.put(
  '/:id',
  handle(async (req, res) => {
    const b = req.body || {};
    const existing = await prisma.deal.findUnique({
      where: { id: req.params.id },
      select: { status: true },
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
    if (b.valueMinor !== undefined) data.valueMinor = toMinor(b.valueMinor) ?? 0n;
    if (b.currency !== undefined) data.currency = String(b.currency).trim() || 'ILS';
    if (b.discountMinor !== undefined) data.discountMinor = toMinor(b.discountMinor);
    if (b.paymentTerms !== undefined)
      data.paymentTerms = b.paymentTerms ? String(b.paymentTerms).trim() : null;
    if (b.source !== undefined) data.source = b.source ? String(b.source).trim() : null;
    if (b.expectedCloseDate !== undefined)
      data.expectedCloseDate = b.expectedCloseDate
        ? new Date(b.expectedCloseDate)
        : null;
    if (b.notes !== undefined) data.notes = b.notes ? String(b.notes).trim() : null;

    // Outcome status transitions stamp/clear wonAt/lostAt.
    if (b.status !== undefined) {
      if (!VALID_STATUS.includes(b.status)) {
        return res.status(400).json({ error: 'invalid_status' });
      }
      data.status = b.status;
      if (b.status === 'won') {
        data.wonAt = new Date();
        data.lostAt = null;
        data.lostReason = null;
      } else if (b.status === 'lost') {
        data.lostAt = new Date();
        data.wonAt = null;
        data.lostReason = b.lostReason ? String(b.lostReason).trim() : null;
      } else {
        data.wonAt = null;
        data.lostAt = null;
        data.lostReason = null;
      }
    } else if (b.lostReason !== undefined && existing.status === 'lost') {
      data.lostReason = b.lostReason ? String(b.lostReason).trim() : null;
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

export default router;
