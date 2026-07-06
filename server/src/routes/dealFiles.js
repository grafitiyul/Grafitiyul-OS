import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import * as r2 from '../r2.js';

// Deal Files — mounted at /api/deals, serves /:dealId/files*. PRIVATE by
// contract: unlike MediaFile there is NO public URL. Objects live under
// `deals/<dealId>/…`; downloads go only through the admin-authed /download route
// which mints a short-lived presigned GET and redirects (§15: no public file
// URLs). Two-step upload (same shape as mediaFiles): presign → client PUTs bytes
// straight to R2 → persist the DealFile row.

const router = Router();

const MAX_BYTES = 50 * 1024 * 1024; // 50MB per file

async function ensureDeal(req, res) {
  const deal = await prisma.deal.findUnique({ where: { id: req.params.dealId }, select: { id: true } });
  if (!deal) {
    res.status(404).json({ error: 'deal_not_found' });
    return null;
  }
  return deal;
}

function toClient(f) {
  return {
    id: f.id,
    dealId: f.dealId,
    filename: f.filename,
    mimeType: f.mimeType,
    sizeBytes: f.sizeBytes,
    uploadedById: f.uploadedById,
    createdAt: f.createdAt,
  };
}

// GET /:dealId/files — newest first.
router.get(
  '/:dealId/files',
  handle(async (req, res) => {
    const deal = await ensureDeal(req, res);
    if (!deal) return;
    const files = await prisma.dealFile.findMany({
      where: { dealId: deal.id },
      orderBy: { createdAt: 'desc' },
    });
    res.set('Cache-Control', 'no-store');
    res.json(files.map(toClient));
  }),
);

// POST /:dealId/files/presign — { filename, contentType } → signed PUT URL + key.
router.post(
  '/:dealId/files/presign',
  handle(async (req, res) => {
    const deal = await ensureDeal(req, res);
    if (!deal) return;
    if (!r2.isConfigured()) return res.status(503).json({ error: 'r2_not_configured' });
    const filename = String(req.body?.filename || 'file').slice(0, 200);
    const contentType = String(req.body?.contentType || 'application/octet-stream').slice(0, 120);
    const key = r2.buildKey(`deals/${deal.id}`, filename);
    const uploadUrl = await r2.presignPut({ key, contentType });
    res.set('Cache-Control', 'no-store');
    res.json({ uploadUrl, key });
  }),
);

// POST /:dealId/files — persist the row after the client PUT to R2 succeeded.
router.post(
  '/:dealId/files',
  handle(async (req, res) => {
    const deal = await ensureDeal(req, res);
    if (!deal) return;
    const b = req.body || {};
    const key = String(b.key || '').trim();
    if (!key) return res.status(400).json({ error: 'key_required' });
    // Guard the namespace: a client must not persist a row pointing at another
    // deal's object (or an arbitrary key).
    if (!key.startsWith(`deals/${deal.id}/`)) return res.status(400).json({ error: 'key_out_of_scope' });
    const sizeBytes = Number(b.sizeBytes) || 0;
    if (sizeBytes > MAX_BYTES) return res.status(400).json({ error: 'file_too_large' });
    try {
      const created = await prisma.dealFile.create({
        data: {
          dealId: deal.id,
          r2Key: key,
          bucket: r2.bucket || '',
          filename: String(b.filename || 'file').slice(0, 200),
          mimeType: String(b.mimeType || 'application/octet-stream').slice(0, 120),
          sizeBytes,
          uploadedById: req.adminAuth?.userId || null,
        },
      });
      res.status(201).json(toClient(created));
    } catch (e) {
      if (e.code === 'P2002') return res.status(409).json({ error: 'key_exists' });
      throw e;
    }
  }),
);

// GET /:dealId/files/:fileId/download — mint a short-lived presigned GET for the
// PRIVATE object and redirect. The only door to the bytes.
router.get(
  '/:dealId/files/:fileId/download',
  handle(async (req, res) => {
    const file = await prisma.dealFile.findUnique({ where: { id: req.params.fileId } });
    if (!file || file.dealId !== req.params.dealId) return res.status(404).json({ error: 'not_found' });
    if (!r2.isConfigured()) return res.status(503).json({ error: 'storage_not_configured' });
    const url = await r2.presignGet({ key: file.r2Key, expiresIn: 300 });
    res.set('Cache-Control', 'no-store');
    res.redirect(302, url);
  }),
);

// DELETE /:dealId/files/:fileId — remove the row + best-effort delete the object.
router.delete(
  '/:dealId/files/:fileId',
  handle(async (req, res) => {
    const file = await prisma.dealFile.findUnique({ where: { id: req.params.fileId } });
    if (!file || file.dealId !== req.params.dealId) return res.status(404).json({ error: 'not_found' });
    await prisma.dealFile.delete({ where: { id: file.id } });
    if (r2.isConfigured()) await r2.deleteObject(file.r2Key);
    res.status(204).end();
  }),
);

export default router;
