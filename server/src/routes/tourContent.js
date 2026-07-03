import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import * as svc from '../tour-content/tourContent.js';

// Tour Content admin HTTP surface (Phase 1a). Thin routes over the service, which
// owns all Prisma + rules. Mounted under /api/tour-content (admin-only, no-store).
// No R2 uploads here: assets take a stable `url` OR an existing MediaFile `mediaId`.

const router = Router();

// Map known service error codes → HTTP status; rethrow the rest (→ 500 handler).
const STATUS = {
  title_required: 400,
  invalid_kind: 400,
  invalid_asset_type: 400,
  invalid_language: 400,
  asset_source_required: 400,
  asset_source_conflict: 400,
  block_ref_required: 400,
  invalid_order: 400,
  order_mismatch: 400,
  order_duplicate: 400,
  tour_not_found: 404,
  station_not_found: 404,
  block_not_found: 404,
  step_not_found: 404,
  asset_not_found: 404,
  note_not_found: 404,
  media_not_found: 404,
  has_placements: 409,
};

function fail(res, e) {
  if (e?.code === 'P2025') return res.status(404).json({ error: 'not_found' });
  const s = STATUS[e?.code];
  if (s) {
    const body = { error: e.code };
    if (e.count != null) body.count = e.count;
    if (e.allowed) body.allowed = e.allowed;
    if (e.expected != null) body.expected = e.expected;
    if (e.got != null) body.got = e.got;
    return res.status(s).json(body);
  }
  throw e;
}

const boolParam = (v) => (v === 'true' ? true : v === 'false' ? false : undefined);
const wrap = (fn) => handle(async (req, res) => { try { await fn(req, res); } catch (e) { fail(res, e); } });
const orderOf = (req) => req.body?.order ?? req.body?.orderIds;

// ── Tours ───────────────────────────────────────────────────────────────────
router.get('/tours', wrap(async (req, res) => res.json(await svc.listTours(prisma, { active: boolParam(req.query.active) }))));
router.post('/tours', wrap(async (req, res) => res.status(201).json(await svc.createTour(prisma, req.body || {}))));
router.put('/tours/reorder', wrap(async (req, res) => res.json(await svc.reorderTours(prisma, orderOf(req)))));
router.get('/tours/:id', wrap(async (req, res) => {
  const t = await svc.getTour(prisma, req.params.id);
  if (!t) return res.status(404).json({ error: 'not_found' });
  res.json(t);
}));
router.put('/tours/:id', wrap(async (req, res) => res.json(await svc.updateTour(prisma, req.params.id, req.body || {}))));
router.delete('/tours/:id', wrap(async (req, res) => { await svc.deleteTour(prisma, req.params.id); res.status(204).end(); }));

// ── Stations (scoped under a tour for create/list/reorder) ──────────────────────
router.get('/tours/:tourId/stations', wrap(async (req, res) => res.json(await svc.listStations(prisma, req.params.tourId))));
router.post('/tours/:tourId/stations', wrap(async (req, res) => res.status(201).json(await svc.createStation(prisma, req.params.tourId, req.body || {}))));
router.put('/tours/:tourId/stations/reorder', wrap(async (req, res) => res.json(await svc.reorderStations(prisma, req.params.tourId, orderOf(req)))));
router.get('/stations/:id', wrap(async (req, res) => {
  const s = await svc.getStation(prisma, req.params.id);
  if (!s) return res.status(404).json({ error: 'not_found' });
  res.json(s);
}));
router.put('/stations/:id', wrap(async (req, res) => res.json(await svc.updateStation(prisma, req.params.id, req.body || {}))));
router.delete('/stations/:id', wrap(async (req, res) => { await svc.deleteStation(prisma, req.params.id); res.status(204).end(); }));

// ── Content blocks (reusable library) ───────────────────────────────────────────
router.get('/blocks', wrap(async (req, res) => res.json(await svc.listBlocks(prisma, {
  shared: boolParam(req.query.shared),
  active: boolParam(req.query.active),
  q: req.query.q || undefined,
}))));
router.post('/blocks', wrap(async (req, res) => res.status(201).json(await svc.createBlock(prisma, req.body || {}))));
router.get('/blocks/:id', wrap(async (req, res) => {
  const b = await svc.getBlock(prisma, req.params.id);
  if (!b) return res.status(404).json({ error: 'not_found' });
  res.json(b);
}));
router.get('/blocks/:id/where-used', wrap(async (req, res) => res.json(await svc.whereUsed(prisma, req.params.id))));
router.put('/blocks/:id', wrap(async (req, res) => res.json(await svc.updateBlock(prisma, req.params.id, req.body || {}))));
router.delete('/blocks/:id', wrap(async (req, res) => { await svc.deleteBlock(prisma, req.params.id); res.status(204).end(); }));

// ── Steps (ordered placement of a block into a station) ─────────────────────────
router.get('/stations/:stationId/steps', wrap(async (req, res) => res.json(await svc.listSteps(prisma, req.params.stationId))));
router.post('/stations/:stationId/steps', wrap(async (req, res) => res.status(201).json(await svc.createStep(prisma, req.params.stationId, req.body || {}))));
router.put('/stations/:stationId/steps/reorder', wrap(async (req, res) => res.json(await svc.reorderSteps(prisma, req.params.stationId, orderOf(req)))));
router.put('/steps/:id', wrap(async (req, res) => res.json(await svc.updateStep(prisma, req.params.id, req.body || {}))));
router.delete('/steps/:id', wrap(async (req, res) => { await svc.deleteStep(prisma, req.params.id); res.status(204).end(); }));

// ── Block assets ────────────────────────────────────────────────────────────────
router.get('/blocks/:blockId/assets', wrap(async (req, res) => res.json(await svc.listAssets(prisma, req.params.blockId))));
router.post('/blocks/:blockId/assets', wrap(async (req, res) => res.status(201).json(await svc.createAsset(prisma, req.params.blockId, req.body || {}))));
router.put('/blocks/:blockId/assets/reorder', wrap(async (req, res) => res.json(await svc.reorderAssets(prisma, req.params.blockId, orderOf(req)))));
router.put('/assets/:id', wrap(async (req, res) => res.json(await svc.updateAsset(prisma, req.params.id, req.body || {}))));
router.delete('/assets/:id', wrap(async (req, res) => { await svc.deleteAsset(prisma, req.params.id); res.status(204).end(); }));

// ── Station notes (admin-only) ──────────────────────────────────────────────────
router.get('/stations/:stationId/notes', wrap(async (req, res) => res.json(await svc.listNotes(prisma, req.params.stationId))));
router.post('/stations/:stationId/notes', wrap(async (req, res) => res.status(201).json(await svc.createNote(prisma, req.params.stationId, req.body || {}))));
router.put('/stations/:stationId/notes/reorder', wrap(async (req, res) => res.json(await svc.reorderNotes(prisma, req.params.stationId, orderOf(req)))));
router.put('/notes/:id', wrap(async (req, res) => res.json(await svc.updateNote(prisma, req.params.id, req.body || {}))));
router.delete('/notes/:id', wrap(async (req, res) => { await svc.deleteNote(prisma, req.params.id); res.status(204).end(); }));

export default router;
