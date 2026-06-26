import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import * as r2 from '../r2.js';

// MediaFile = R2 object metadata. Two-step direct upload:
//   1) POST /presign  → presigned PUT URL + key + public URL
//   2) client PUTs bytes straight to R2
//   3) POST /          → persist the MediaFile row, return { id, url }
// DELETE /:id removes the row and best-effort deletes the R2 object.

const router = Router();
const ALLOWED = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

router.post(
  '/presign',
  handle(async (req, res) => {
    if (!r2.isConfigured()) {
      return res.status(503).json({ error: 'r2_not_configured' });
    }
    const filename = String(req.body?.filename || 'image').slice(0, 200);
    const contentType = String(req.body?.contentType || '');
    if (!ALLOWED.has(contentType)) {
      return res.status(400).json({ error: 'unsupported_type' });
    }
    const folder = String(req.body?.folder || 'products').slice(0, 40);
    const key = r2.buildKey(folder, filename);
    const uploadUrl = await r2.presignPut({ key, contentType });
    res.json({ uploadUrl, key, publicUrl: r2.publicUrl(key), bucket: r2.bucket });
  }),
);

router.post(
  '/',
  handle(async (req, res) => {
    const b = req.body || {};
    const key = String(b.key || '').trim();
    if (!key) return res.status(400).json({ error: 'key_required' });
    const mf = await prisma.mediaFile.create({
      data: {
        r2Key: key,
        url: b.url || r2.publicUrl(key),
        bucket: b.bucket || r2.bucket || '',
        filename: String(b.filename || 'image').slice(0, 200),
        mimeType: String(b.mimeType || 'image/jpeg'),
        sizeBytes: Number(b.sizeBytes) || 0,
        width: b.width != null ? Number(b.width) : null,
        height: b.height != null ? Number(b.height) : null,
        kind: 'image',
        uploadedById: req.adminAuth?.userId || null,
      },
    });
    res.status(201).json(mf);
  }),
);

router.delete(
  '/:id',
  handle(async (req, res) => {
    const mf = await prisma.mediaFile.findUnique({ where: { id: req.params.id } });
    if (!mf) return res.status(404).json({ error: 'not_found' });
    await prisma.mediaFile.delete({ where: { id: mf.id } });
    if (r2.isConfigured()) await r2.deleteObject(mf.r2Key);
    res.status(204).end();
  }),
);

export default router;
