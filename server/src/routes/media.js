import express, { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

const router = Router();

const MAX_IMAGE = 25 * 1024 * 1024;
const MAX_VIDEO = 200 * 1024 * 1024;

const ALLOWED_IMAGE = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

const ALLOWED_VIDEO = new Set([
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
]);

// Upload: raw binary body. The body parser is mounted only on this route so
// it doesn't compete with the app-level express.json() middleware.
router.post(
  '/upload',
  express.raw({ type: '*/*', limit: '250mb' }),
  handle(async (req, res) => {
    const kind = String(req.query.kind || '');
    const filename = String(req.query.filename || 'file').slice(0, 200);
    const mimeType = req.get('content-type') || 'application/octet-stream';
    const body = req.body;

    if (!Buffer.isBuffer(body) || body.length === 0) {
      return res.status(400).json({ error: 'empty body' });
    }
    if (kind !== 'image' && kind !== 'video') {
      return res.status(400).json({ error: 'invalid kind' });
    }
    const allowed = kind === 'image' ? ALLOWED_IMAGE : ALLOWED_VIDEO;
    if (!allowed.has(mimeType)) {
      return res.status(400).json({ error: `unsupported mime type: ${mimeType}` });
    }
    const maxSize = kind === 'image' ? MAX_IMAGE : MAX_VIDEO;
    if (body.length > maxSize) {
      return res.status(413).json({ error: 'too large' });
    }

    const asset = await prisma.mediaAsset.create({
      data: {
        kind,
        mimeType,
        filename,
        byteSize: body.length,
        bytes: body,
      },
      select: {
        id: true,
        kind: true,
        mimeType: true,
        filename: true,
        byteSize: true,
      },
    });
    res.status(201).json({
      ...asset,
      url: `/api/media/${asset.id}`,
    });
  }),
);

// Serve bytes. Content is immutable for a given id → safe long cache.
router.get(
  '/:id',
  handle(async (req, res) => {
    const asset = await prisma.mediaAsset.findUnique({
      where: { id: req.params.id },
    });
    if (!asset) {
      res.set('Cache-Control', 'no-store');
      return res.status(404).json({ error: 'not found' });
    }
    res.set('Content-Type', asset.mimeType);
    res.set('Content-Length', String(asset.byteSize));
    res.set(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(asset.filename)}"`,
    );
    // This overrides the /api-level no-store middleware because it's set
    // after it in the response lifecycle.
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(Buffer.from(asset.bytes));
  }),
);

export default router;
