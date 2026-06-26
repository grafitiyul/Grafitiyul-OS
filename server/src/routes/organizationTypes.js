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
    const { label, labelEn, sortOrder, isActive } = req.body || {};
    const data = {};
    if (label !== undefined) data.label = String(label).trim();
    if (labelEn !== undefined)
      data.labelEn = labelEn ? String(labelEn).trim() : null;
    if (sortOrder !== undefined) data.sortOrder = Number(sortOrder) || 0;
    if (isActive !== undefined) data.isActive = !!isActive;
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
