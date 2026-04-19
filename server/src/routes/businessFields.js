import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

const router = Router();

// Slug-ify a label into a stable key when the client doesn't provide one.
// Lower-case, ASCII-safe, trimmed to 48 chars.
function makeKey(label) {
  const base = String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return base || 'field_' + Math.random().toString(36).slice(2, 8);
}

router.get(
  '/',
  handle(async (_req, res) => {
    const items = await prisma.businessField.findMany({
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    res.json(items);
  }),
);

// Input body accepts `valueHe` + `valueEn`. Legacy `value` is also accepted
// and written into `valueHe` so older clients (or a stale admin window open
// across the deploy) don't crash — forward-compatible read shape.
function readBilingualValues(body) {
  const out = {};
  if (body.valueHe !== undefined) out.valueHe = String(body.valueHe ?? '');
  else if (body.value !== undefined) out.valueHe = String(body.value ?? '');
  if (body.valueEn !== undefined) out.valueEn = String(body.valueEn ?? '');
  return out;
}

router.post(
  '/',
  handle(async (req, res) => {
    const { key, label, category, order } = req.body || {};
    if (!label || !String(label).trim()) {
      return res.status(400).json({ error: 'label required' });
    }
    let finalKey = key && String(key).trim() ? String(key).trim() : makeKey(label);

    // De-dupe: if the key is taken, suffix with a random tail.
    const existing = await prisma.businessField.findUnique({
      where: { key: finalKey },
    });
    if (existing) finalKey = `${finalKey}_${Math.random().toString(36).slice(2, 5)}`;

    const { valueHe = '', valueEn = '' } = readBilingualValues(req.body || {});

    const created = await prisma.businessField.create({
      data: {
        key: finalKey,
        label: String(label).trim(),
        valueHe,
        valueEn,
        category: category ? String(category) : null,
        order: Number.isFinite(order) ? order : 0,
      },
    });
    res.status(201).json(created);
  }),
);

router.put(
  '/:id',
  handle(async (req, res) => {
    const { label, category, order } = req.body || {};
    const data = {};
    if (label !== undefined) data.label = String(label);
    Object.assign(data, readBilingualValues(req.body || {}));
    if (category !== undefined) data.category = category ? String(category) : null;
    if (order !== undefined && Number.isFinite(order)) data.order = order;
    const updated = await prisma.businessField.update({
      where: { id: req.params.id },
      data,
    });
    res.json(updated);
  }),
);

router.delete(
  '/:id',
  handle(async (req, res) => {
    // Guard: block delete if referenced by any DocumentField.
    const inUse = await prisma.documentField.count({
      where: { businessFieldId: req.params.id },
    });
    if (inUse > 0) {
      return res.status(409).json({
        error: 'field_in_use',
        templatesCount: inUse,
      });
    }
    await prisma.businessField.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

export default router;
