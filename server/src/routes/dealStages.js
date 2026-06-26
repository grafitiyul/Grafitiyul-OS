import crypto from 'node:crypto';
import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

// Deal pipeline stages (configuration, ordered). Managed in CRM settings,
// drag-orderable. A stage is a pipeline POSITION; won/lost is the Deal's
// `status`, kept separate so a closed deal still remembers its last stage.
//
// Lazy seed: the first time stages are listed and none exist, a sensible
// default pipeline is created so deals can be created immediately without a
// manual setup step. Admins can then rename/reorder/extend it.

const router = Router();

const DEFAULT_STAGES = [
  { key: 'lead', label: 'ליד חדש', labelEn: 'New lead' },
  { key: 'contacted', label: 'יצירת קשר', labelEn: 'Contacted' },
  { key: 'quote', label: 'הצעת מחיר', labelEn: 'Quote sent' },
  { key: 'negotiation', label: 'משא ומתן', labelEn: 'Negotiation' },
  { key: 'closing', label: 'סגירה', labelEn: 'Closing' },
];

function slugifyKey(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function ensureSeeded() {
  const count = await prisma.dealStage.count();
  if (count > 0) return;
  await prisma.$transaction(
    DEFAULT_STAGES.map((s, i) =>
      prisma.dealStage.create({ data: { ...s, sortOrder: i } }),
    ),
  );
}

router.get(
  '/',
  handle(async (_req, res) => {
    await ensureSeeded();
    const stages = await prisma.dealStage.findMany({
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
      include: { _count: { select: { deals: true } } },
    });
    res.json(stages);
  }),
);

// Reorder — before '/:id'.
router.put(
  '/reorder',
  handle(async (req, res) => {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.filter((x) => typeof x === 'string')
      : [];
    if (!ids.length) return res.json({ ok: true });
    await prisma.$transaction(
      ids.map((id, i) =>
        prisma.dealStage.update({ where: { id }, data: { sortOrder: i } }),
      ),
    );
    res.json({ ok: true });
  }),
);

router.post(
  '/',
  handle(async (req, res) => {
    const { key, label, labelEn } = req.body || {};
    const cleanLabel = String(label || '').trim();
    if (!cleanLabel) return res.status(400).json({ error: 'label_required' });
    const cleanKey =
      slugifyKey(key) ||
      slugifyKey(labelEn) ||
      slugifyKey(cleanLabel) ||
      `stage_${crypto.randomBytes(4).toString('hex')}`;
    const last = await prisma.dealStage.findFirst({
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    try {
      const stage = await prisma.dealStage.create({
        data: {
          key: cleanKey,
          label: cleanLabel,
          labelEn: labelEn ? String(labelEn).trim() : null,
          sortOrder: (last?.sortOrder ?? -1) + 1,
        },
      });
      res.status(201).json(stage);
    } catch (e) {
      if (e.code === 'P2002')
        return res.status(409).json({ error: 'key_exists' });
      throw e;
    }
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
    const stage = await prisma.dealStage.update({
      where: { id: req.params.id },
      data,
    });
    res.json(stage);
  }),
);

router.delete(
  '/:id',
  handle(async (req, res) => {
    try {
      await prisma.dealStage.delete({ where: { id: req.params.id } });
      res.status(204).end();
    } catch (e) {
      // Deal.dealStageId FK is ON DELETE RESTRICT — block deleting a stage that
      // still has deals, with a clear message instead of a 500.
      if (e.code === 'P2003' || e.code === 'P2014') {
        return res.status(409).json({ error: 'stage_in_use' });
      }
      throw e;
    }
  }),
);

export default router;
