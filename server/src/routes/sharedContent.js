import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import {
  listSharedContent,
  getSharedContent,
  createSharedContent,
  updateSharedContent,
  deleteSharedContent,
  getWhereUsed,
  linkVariant,
  forkForVariant,
  convertLegacyToShared,
  detachVariant,
  getVariantSharedContentState,
  getLinkCandidates,
} from '../shared-content/sharedContent.js';

// Shared Content Library HTTP surface (Slices 3 + 4). Thin routes over the
// service (which owns all DB + rules). Everything is by reference — no content is
// ever copied except an explicit fork. Mounted under /api/shared-content.

const router = Router();

const actor = (req) => req.adminAuth?.userId || null;

// Map known service error codes → HTTP status; rethrow the rest (→ 500).
const STATUS = {
  invalid_type: 400,
  internalName_required: 400,
  no_legacy_content: 400,
  shared_content_not_found: 404,
  variant_not_found: 404,
  has_references: 409,
  type_conflict: 409,
};
function fail(res, e) {
  if (e?.code === 'P2025') return res.status(404).json({ error: 'not_found' });
  const s = STATUS[e?.code];
  if (s)
    return res.status(s).json({
      error: e.code,
      ...(e.count != null ? { count: e.count } : {}),
      ...(e.current ? { current: e.current } : {}),
    });
  throw e;
}

const boolParam = (v) => (v === 'true' ? true : v === 'false' ? false : undefined);

// ── Variant-scoped routes (registered before /:id so 'variant' is literal) ────

router.get(
  '/variant/:variantId',
  handle(async (req, res) => {
    const state = await getVariantSharedContentState(prisma, req.params.variantId);
    if (!state) return res.status(404).json({ error: 'variant_not_found' });
    res.json(state);
  }),
);

// Create a new block AND link it to this variant ("Create new" from the variant).
router.post(
  '/variant/:variantId',
  handle(async (req, res) => {
    try {
      const block = await createSharedContent(prisma, req.body || {}, actor(req));
      await linkVariant(prisma, block.id, req.params.variantId);
      res.status(201).json(await getVariantSharedContentState(prisma, req.params.variantId));
    } catch (e) {
      fail(res, e);
    }
  }),
);

// Promote this variant's legacy column content into a shared block + link.
router.post(
  '/variant/:variantId/convert',
  handle(async (req, res) => {
    try {
      await convertLegacyToShared(prisma, req.params.variantId, String(req.body?.type || ''));
      res.status(201).json(await getVariantSharedContentState(prisma, req.params.variantId));
    } catch (e) {
      fail(res, e);
    }
  }),
);

// Detach this variant's link for a type (block stays in the library).
router.delete(
  '/variant/:variantId/:type',
  handle(async (req, res) => {
    await detachVariant(prisma, req.params.variantId, req.params.type);
    res.json(await getVariantSharedContentState(prisma, req.params.variantId));
  }),
);

// ── Library CRUD ──────────────────────────────────────────────────────────────

router.get(
  '/',
  handle(async (req, res) => {
    const rows = await listSharedContent(prisma, {
      type: req.query.type || undefined,
      locationId: req.query.locationId || undefined,
      active: boolParam(req.query.active),
      q: req.query.q || undefined,
    });
    res.json(rows);
  }),
);

router.post(
  '/',
  handle(async (req, res) => {
    try {
      res.status(201).json(await createSharedContent(prisma, req.body || {}, actor(req)));
    } catch (e) {
      fail(res, e);
    }
  }),
);

router.get(
  '/:id',
  handle(async (req, res) => {
    const row = await getSharedContent(prisma, req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(row);
  }),
);

router.get(
  '/:id/where-used',
  handle(async (req, res) => {
    res.json(await getWhereUsed(prisma, req.params.id, req.query.lang === 'en' ? 'en' : 'he'));
  }),
);

router.put(
  '/:id',
  handle(async (req, res) => {
    try {
      res.json(await updateSharedContent(prisma, req.params.id, req.body || {}, actor(req)));
    } catch (e) {
      fail(res, e);
    }
  }),
);

router.delete(
  '/:id',
  handle(async (req, res) => {
    try {
      await deleteSharedContent(prisma, req.params.id);
      res.status(204).end();
    } catch (e) {
      fail(res, e);
    }
  }),
);

// Candidate variants for linking this item (+ each variant's status for the
// item's type). Powers the library "use in additional variants" panel.
router.get(
  '/:id/link-candidates',
  handle(async (req, res) => {
    const data = await getLinkCandidates(prisma, req.params.id, req.query.lang === 'en' ? 'en' : 'he');
    if (!data) return res.status(404).json({ error: 'not_found' });
    res.json(data);
  }),
);

// Link an existing block to a variant. For a single-cardinality type that already
// links a DIFFERENT block, this returns 409 type_conflict unless { replace:true }
// — the UI must confirm first (never a silent overwrite).
router.post(
  '/:id/link',
  handle(async (req, res) => {
    const variantId = String(req.body?.variantId || '');
    if (!variantId) return res.status(400).json({ error: 'variantId_required' });
    try {
      await linkVariant(prisma, req.params.id, variantId, { replace: !!req.body?.replace });
      res.json(await getVariantSharedContentState(prisma, variantId));
    } catch (e) {
      fail(res, e);
    }
  }),
);

// Fork the block for this variant only (clone + repoint the variant's link).
router.post(
  '/:id/fork',
  handle(async (req, res) => {
    const variantId = String(req.body?.variantId || '');
    if (!variantId) return res.status(400).json({ error: 'variantId_required' });
    try {
      await forkForVariant(prisma, req.params.id, variantId);
      res.json(await getVariantSharedContentState(prisma, variantId));
    } catch (e) {
      fail(res, e);
    }
  }),
);

export default router;
