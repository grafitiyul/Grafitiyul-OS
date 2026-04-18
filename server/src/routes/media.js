import express, { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { detectMime, kindOfMime } from '../media/detectMime.js';

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

router.post(
  '/upload',
  express.raw({ type: '*/*', limit: '250mb' }),
  handle(async (req, res) => {
    const kind = String(req.query.kind || '');
    const filename = String(req.query.filename || 'file').slice(0, 200);
    const body = req.body;

    if (!Buffer.isBuffer(body) || body.length === 0) {
      return res.status(400).json({ error: 'empty body' });
    }
    if (kind !== 'image' && kind !== 'video') {
      return res.status(400).json({ error: 'invalid kind' });
    }

    // The browser-reported Content-Type is NOT trusted. We sniff magic bytes.
    const detectedMime = detectMime(body);
    if (!detectedMime) {
      return res
        .status(400)
        .json({ error: 'unsupported or corrupt file format' });
    }
    const detectedKind = kindOfMime(detectedMime);
    if (detectedKind !== kind) {
      return res.status(400).json({
        error: `declared kind=${kind} but file content is ${detectedKind}`,
      });
    }
    const allowed = kind === 'image' ? ALLOWED_IMAGE : ALLOWED_VIDEO;
    if (!allowed.has(detectedMime)) {
      return res
        .status(400)
        .json({ error: `unsupported ${kind} format: ${detectedMime}` });
    }

    const maxSize = kind === 'image' ? MAX_IMAGE : MAX_VIDEO;
    if (body.length > maxSize) {
      return res.status(413).json({ error: 'too large' });
    }

    const asset = await prisma.mediaAsset.create({
      data: {
        kind,
        // Persist the DETECTED mime, not whatever the browser claimed.
        mimeType: detectedMime,
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
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(Buffer.from(asset.bytes));
  }),
);

export default router;
