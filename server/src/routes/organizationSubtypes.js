import crypto from 'node:crypto';
import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

// Organization SUBTYPE catalog. IMPORTANT: a subtype belongs to the future
// DEAL, not to the Organization. This catalog is PREPARED in Phase 1 but has NO
// consumer yet — a Deal will reference a subtype once Deals are built. Subtypes
// may be scoped to an OrganizationType (e.g. School → Teachers / Students).

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
  handle(async (req, res) => {
    const where = {};
    if (req.query.organizationTypeId) {
      where.organizationTypeId = String(req.query.organizationTypeId);
    }
    const subtypes = await prisma.organizationSubtype.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
      include: {
        organizationType: { select: { id: true, label: true } },
      },
    });
    res.json(subtypes);
  }),
);

router.post(
  '/',
  handle(async (req, res) => {
    const { key, label, labelEn, organizationTypeId, sortOrder } =
      req.body || {};
    const cleanLabel = String(label || '').trim();
    if (!cleanLabel) return res.status(400).json({ error: 'label_required' });
    // `key` is an internal slug (OrganizationSubtype.key), NOT an auth key.
    // Hebrew-only labels slug to empty, so fall back to a generated unique key.
    const cleanKey =
      slugifyKey(key) ||
      slugifyKey(labelEn) ||
      slugifyKey(cleanLabel) ||
      `subtype_${crypto.randomBytes(4).toString('hex')}`;
    try {
      const subtype = await prisma.organizationSubtype.create({
        data: {
          key: cleanKey,
          label: cleanLabel,
          labelEn: labelEn ? String(labelEn).trim() : null,
          organizationTypeId: organizationTypeId || null,
          sortOrder: Number.isFinite(sortOrder) ? Number(sortOrder) : 0,
        },
      });
      res.status(201).json(subtype);
    } catch (e) {
      if (e.code === 'P2002')
        return res.status(409).json({ error: 'key_exists' });
      throw e;
    }
  }),
);

// Persist explicit display order (sortOrder = index). Before '/:id'.
router.put(
  '/reorder',
  handle(async (req, res) => {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.filter((x) => typeof x === 'string')
      : [];
    if (!ids.length) return res.json({ ok: true });
    await prisma.$transaction(
      ids.map((id, i) =>
        prisma.organizationSubtype.update({
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
    const { label, labelEn, organizationTypeId, sortOrder, isActive } =
      req.body || {};
    const data = {};
    if (label !== undefined) data.label = String(label).trim();
    if (labelEn !== undefined)
      data.labelEn = labelEn ? String(labelEn).trim() : null;
    if (organizationTypeId !== undefined)
      data.organizationTypeId = organizationTypeId || null;
    if (sortOrder !== undefined) data.sortOrder = Number(sortOrder) || 0;
    if (isActive !== undefined) data.isActive = !!isActive;
    const subtype = await prisma.organizationSubtype.update({
      where: { id: req.params.id },
      data,
    });
    res.json(subtype);
  }),
);

router.delete(
  '/:id',
  handle(async (req, res) => {
    await prisma.organizationSubtype.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

export default router;
