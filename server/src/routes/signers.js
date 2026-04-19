import express, { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

const router = Router();

const MAX_ASSET_BYTES = 5 * 1024 * 1024; // 5 MB is plenty for a PNG signature / stamp

function isPng(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return false;
  return (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  );
}

// Parse a data URL "data:image/png;base64,...." into a Buffer (PNG only).
function dataUrlToBuffer(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!m) return null;
  try {
    return Buffer.from(m[1], 'base64');
  } catch {
    return null;
  }
}

// ── Persons ──────────────────────────────────────────────────────────────────

router.get(
  '/',
  handle(async (_req, res) => {
    const list = await prisma.signerPerson.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        assets: {
          select: {
            id: true,
            assetType: true,
            label: true,
            byteSize: true,
            stampConfigJson: true,
            createdAt: true,
          },
        },
      },
    });
    res.json(list);
  }),
);

router.get(
  '/:id',
  handle(async (req, res) => {
    const p = await prisma.signerPerson.findUnique({
      where: { id: req.params.id },
      include: {
        assets: {
          select: {
            id: true,
            assetType: true,
            label: true,
            byteSize: true,
            stampConfigJson: true,
            createdAt: true,
          },
        },
      },
    });
    if (!p) return res.status(404).json({ error: 'not found' });
    res.json(p);
  }),
);

router.post(
  '/',
  handle(async (req, res) => {
    const { displayName, role, email, phone, extraFields } = req.body || {};
    if (!displayName || !String(displayName).trim()) {
      return res.status(400).json({ error: 'displayName required' });
    }
    const created = await prisma.signerPerson.create({
      data: {
        displayName: String(displayName).trim(),
        role: role ? String(role) : null,
        email: email ? String(email) : null,
        phone: phone ? String(phone) : null,
        extraFields:
          extraFields && typeof extraFields === 'object' ? extraFields : {},
      },
    });
    res.status(201).json(created);
  }),
);

router.put(
  '/:id',
  handle(async (req, res) => {
    const { displayName, role, email, phone, extraFields } = req.body || {};
    const data = {};
    if (displayName !== undefined) data.displayName = String(displayName);
    if (role !== undefined) data.role = role ? String(role) : null;
    if (email !== undefined) data.email = email ? String(email) : null;
    if (phone !== undefined) data.phone = phone ? String(phone) : null;
    if (extraFields !== undefined && typeof extraFields === 'object') {
      data.extraFields = extraFields;
    }
    const updated = await prisma.signerPerson.update({
      where: { id: req.params.id },
      data,
    });
    res.json(updated);
  }),
);

router.delete(
  '/:id',
  handle(async (req, res) => {
    // Block delete if any DocumentField references this person.
    const inUse = await prisma.documentField.count({
      where: { signerPersonId: req.params.id },
    });
    if (inUse > 0) {
      return res.status(409).json({ error: 'signer_in_use', count: inUse });
    }
    await prisma.signerPerson.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

// ── Assets ───────────────────────────────────────────────────────────────────
//
// JSON creation flavours (primary):
//   POST /:id/assets/draw       { dataUrl, label? }
//   POST /:id/assets/stamp      { dataUrl, stampConfig, label? }
//   POST /:id/assets/combined   { dataUrl, layout, label? }
//
// PNG-upload fallback:
//   POST /:id/assets/image      raw PNG bytes ?assetType=stamp|combined&label=
//
// Update (in-place re-edit, keeps asset id stable):
//   PUT  /:id/assets/:assetId   { dataUrl?, stampConfigJson?, label? }
//
// Selection for the list returns `stampConfigJson` so the client can reopen
// the correct builder (stamp / combined) pre-populated.

const ASSET_SELECT = {
  id: true,
  personId: true,
  assetType: true,
  label: true,
  byteSize: true,
  stampConfigJson: true,
  createdAt: true,
};

router.get(
  '/:id/assets',
  handle(async (req, res) => {
    const assets = await prisma.signerAsset.findMany({
      where: { personId: req.params.id },
      orderBy: { createdAt: 'desc' },
      select: ASSET_SELECT,
    });
    res.json(assets);
  }),
);

router.get(
  '/:id/assets/:assetId/png',
  handle(async (req, res) => {
    const asset = await prisma.signerAsset.findFirst({
      where: { id: req.params.assetId, personId: req.params.id },
    });
    if (!asset) return res.status(404).json({ error: 'not found' });
    res.set('Content-Type', 'image/png');
    res.set('Content-Length', String(asset.byteSize));
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(Buffer.from(asset.renderedBytes));
  }),
);

router.post(
  '/:id/assets/draw',
  handle(async (req, res) => {
    const { dataUrl, label } = req.body || {};
    const buf = dataUrlToBuffer(dataUrl);
    if (!buf || !isPng(buf)) {
      return res.status(400).json({ error: 'invalid_png_data_url' });
    }
    if (buf.length > MAX_ASSET_BYTES) {
      return res.status(413).json({ error: 'too_large' });
    }
    const person = await prisma.signerPerson.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!person) return res.status(404).json({ error: 'person_not_found' });

    const created = await prisma.signerAsset.create({
      data: {
        personId: person.id,
        assetType: 'draw',
        label: label ? String(label) : null,
        renderedBytes: buf,
        drawBytes: buf,
        byteSize: buf.length,
      },
      select: ASSET_SELECT,
    });
    res.status(201).json(created);
  }),
);

router.post(
  '/:id/assets/image',
  express.raw({ type: '*/*', limit: '6mb' }),
  handle(async (req, res) => {
    const assetType = String(req.query.assetType || '');
    const label = req.query.label ? String(req.query.label) : null;
    if (assetType !== 'stamp' && assetType !== 'combined' && assetType !== 'draw') {
      return res.status(400).json({ error: 'invalid_assetType' });
    }
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      return res.status(400).json({ error: 'empty_body' });
    }
    if (!isPng(body)) {
      return res.status(400).json({ error: 'png_required' });
    }
    if (body.length > MAX_ASSET_BYTES) {
      return res.status(413).json({ error: 'too_large' });
    }
    const person = await prisma.signerPerson.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!person) return res.status(404).json({ error: 'person_not_found' });

    const created = await prisma.signerAsset.create({
      data: {
        personId: person.id,
        assetType,
        label,
        renderedBytes: body,
        byteSize: body.length,
      },
      select: ASSET_SELECT,
    });
    res.status(201).json(created);
  }),
);

// Stamp builder create — persists rendered PNG + the StampConfig JSON so the
// builder can reopen the exact config later.
router.post(
  '/:id/assets/stamp',
  handle(async (req, res) => {
    const { dataUrl, stampConfig, label } = req.body || {};
    const buf = dataUrlToBuffer(dataUrl);
    if (!buf || !isPng(buf)) {
      return res.status(400).json({ error: 'invalid_png_data_url' });
    }
    if (buf.length > MAX_ASSET_BYTES) {
      return res.status(413).json({ error: 'too_large' });
    }
    if (!stampConfig || typeof stampConfig !== 'object') {
      return res.status(400).json({ error: 'stampConfig_required' });
    }
    const person = await prisma.signerPerson.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!person) return res.status(404).json({ error: 'person_not_found' });

    const created = await prisma.signerAsset.create({
      data: {
        personId: person.id,
        assetType: 'stamp',
        label: label ? String(label) : null,
        renderedBytes: buf,
        stampConfigJson: stampConfig,
        byteSize: buf.length,
      },
      select: ASSET_SELECT,
    });
    res.status(201).json(created);
  }),
);

// Combined builder create — persists rendered composite PNG + the full
// CompositionLayout (which references asset_ids of the source draw/stamp)
// so the editor can reopen and continue editing.
router.post(
  '/:id/assets/combined',
  handle(async (req, res) => {
    const { dataUrl, layout, label } = req.body || {};
    const buf = dataUrlToBuffer(dataUrl);
    if (!buf || !isPng(buf)) {
      return res.status(400).json({ error: 'invalid_png_data_url' });
    }
    if (buf.length > MAX_ASSET_BYTES) {
      return res.status(413).json({ error: 'too_large' });
    }
    if (!layout || typeof layout !== 'object' || !Array.isArray(layout.elements)) {
      return res.status(400).json({ error: 'layout_required' });
    }
    const person = await prisma.signerPerson.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!person) return res.status(404).json({ error: 'person_not_found' });

    const created = await prisma.signerAsset.create({
      data: {
        personId: person.id,
        assetType: 'combined',
        label: label ? String(label) : null,
        renderedBytes: buf,
        stampConfigJson: layout,
        byteSize: buf.length,
      },
      select: ASSET_SELECT,
    });
    res.status(201).json(created);
  }),
);

// In-place update — keeps asset id stable so existing document references
// keep pointing to the same conceptual asset after a re-edit. Accepts any
// subset of { dataUrl, stampConfig, layout, label }.
router.put(
  '/:id/assets/:assetId',
  handle(async (req, res) => {
    const { dataUrl, stampConfig, layout, label } = req.body || {};
    const existing = await prisma.signerAsset.findFirst({
      where: { id: req.params.assetId, personId: req.params.id },
    });
    if (!existing) return res.status(404).json({ error: 'not_found' });

    const data = {};
    if (dataUrl !== undefined) {
      const buf = dataUrlToBuffer(dataUrl);
      if (!buf || !isPng(buf)) {
        return res.status(400).json({ error: 'invalid_png_data_url' });
      }
      if (buf.length > MAX_ASSET_BYTES) {
        return res.status(413).json({ error: 'too_large' });
      }
      data.renderedBytes = buf;
      data.byteSize = buf.length;
    }
    if (stampConfig !== undefined) data.stampConfigJson = stampConfig;
    if (layout !== undefined) data.stampConfigJson = layout;
    if (label !== undefined) data.label = label ? String(label) : null;

    const updated = await prisma.signerAsset.update({
      where: { id: existing.id },
      data,
      select: ASSET_SELECT,
    });
    res.json(updated);
  }),
);

router.delete(
  '/:id/assets/:assetId',
  handle(async (req, res) => {
    // Cascade is safe via unique — no DocumentField column references asset ids.
    // (Fields reference person + mode, and look up the latest matching asset at
    // render time.)
    await prisma.signerAsset.delete({ where: { id: req.params.assetId } });
    res.status(204).end();
  }),
);

export default router;
