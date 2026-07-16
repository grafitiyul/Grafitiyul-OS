import crypto from 'node:crypto';
import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

// Organization Type catalog (School / Corporate / Municipality / Government /
// University / NGO / …). Configuration data: logic always references `key`,
// never the Hebrew label. Will LATER drive pricing, quote wording, payment
// terms, email templates and workflows — none of which is built in Phase 1.

const router = Router();

function slugifyKey(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

router.get(
  '/',
  handle(async (_req, res) => {
    const types = await prisma.organizationType.findMany({
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
      include: {
        _count: { select: { organizations: true, subtypes: true } },
        // Payment defaults. The term carries its OWN configured default method
        // (defaultPaymentMethodId) so the UI can tell inherited from overridden
        // without re-querying the catalog. defaultPaymentMethod is the override.
        defaultPaymentTerm: {
          select: { id: true, nameHe: true, defaultPaymentMethodId: true },
        },
        defaultPaymentMethod: { select: { id: true, nameHe: true } },
      },
    });
    res.json(types);
  }),
);

router.post(
  '/',
  handle(async (req, res) => {
    const { key, label, labelEn, sortOrder } = req.body || {};
    const cleanLabel = String(label || '').trim();
    if (!cleanLabel) return res.status(400).json({ error: 'label_required' });
    // `key` is an internal slug (OrganizationType.key), NOT an auth key. Latin
    // labels slug nicely; Hebrew-only labels slug to empty, so fall back to a
    // generated unique key. The label is what's displayed; the key is internal.
    const cleanKey =
      slugifyKey(key) ||
      slugifyKey(labelEn) ||
      slugifyKey(cleanLabel) ||
      `type_${crypto.randomBytes(4).toString('hex')}`;
    try {
      const type = await prisma.organizationType.create({
        data: {
          key: cleanKey,
          label: cleanLabel,
          labelEn: labelEn ? String(labelEn).trim() : null,
          sortOrder: Number.isFinite(sortOrder) ? Number(sortOrder) : 0,
        },
      });
      res.status(201).json(type);
    } catch (e) {
      if (e.code === 'P2002')
        return res.status(409).json({ error: 'key_exists' });
      throw e;
    }
  }),
);

// Persist an explicit display order. `ids` is the full list in the desired
// order; sortOrder is set to the array index. Registered BEFORE '/:id' so the
// literal path isn't captured as an id.
router.put(
  '/reorder',
  handle(async (req, res) => {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.filter((x) => typeof x === 'string')
      : [];
    if (!ids.length) return res.json({ ok: true });
    await prisma.$transaction(
      ids.map((id, i) =>
        prisma.organizationType.update({
          where: { id },
          data: { sortOrder: i },
        }),
      ),
    );
    res.json({ ok: true });
  }),
);

router.put(
  '/:id',
  handle(async (req, res) => {
    const {
      label,
      labelEn,
      sortOrder,
      isActive,
      defaultPriceListId,
      quoteContentHe,
      quoteContentEn,
      defaultPaymentTermId,
      defaultPaymentMethodId,
      paymentTermsNote,
      agentReservations,
    } = req.body || {};
    const data = {};
    if (label !== undefined) data.label = String(label).trim();
    if (labelEn !== undefined)
      data.labelEn = labelEn ? String(labelEn).trim() : null;
    if (sortOrder !== undefined) data.sortOrder = Number(sortOrder) || 0;
    if (isActive !== undefined) data.isActive = !!isActive;
    // Pricing (Slice 2): default price list for this org type ('' clears it).
    if (defaultPriceListId !== undefined)
      data.defaultPriceListId = defaultPriceListId || null;
    // Quote content (rich HTML) owned by the org classification. NOT wired to
    // Quotes yet — stored for future automatic insertion by type/subtype.
    if (quoteContentHe !== undefined)
      data.quoteContentHe = quoteContentHe || null;
    if (quoteContentEn !== undefined)
      data.quoteContentEn = quoteContentEn || null;
    // Payment defaults. Term/method reference the Payment Configuration catalog
    // ('' clears → null). A null defaultPaymentMethodId means "inherit the
    // term's own default method" (handled by the UI / future resolution).
    if (defaultPaymentTermId !== undefined)
      data.defaultPaymentTermId = defaultPaymentTermId || null;
    if (defaultPaymentMethodId !== undefined)
      data.defaultPaymentMethodId = defaultPaymentMethodId || null;
    if (paymentTermsNote !== undefined)
      data.paymentTermsNote = paymentTermsNote?.trim() ? paymentTermsNote.trim() : null;
    // Travel Agency Reservations capability: contacts of orgs of this type may
    // hold a permanent reservation link. Eligibility re-checks live, so
    // toggling this off immediately locks every dependent link (safe 403).
    if (agentReservations !== undefined) data.agentReservations = !!agentReservations;
    const type = await prisma.organizationType.update({
      where: { id: req.params.id },
      data,
    });
    res.json(type);
  }),
);

router.delete(
  '/:id',
  handle(async (req, res) => {
    // Organization.organizationTypeId and OrganizationSubtype.organizationTypeId
    // are onDelete:SetNull — deleting a type unlinks rather than cascading.
    await prisma.organizationType.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

export default router;
