import { Router } from 'express';
import crypto from 'node:crypto';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

// ── Tour Content export (server-to-server READ API) ──────────────────────────────
//
// GOS is the source of truth for tour content. This surface lets the recruitment
// system CONSUME that content at runtime (its trainee portal + admin editor),
// keyed by the ORIGINAL recruitment integer ids (via sourceRef "station:<id>" /
// "tour:<id>"), so recruitment can map its local access-control rows onto GOS
// content without knowing GOS cuids.
//
// Auth: shared secret header `x-internal-export-secret` (constant-time compare),
// mirroring recruitment's own export surface. Read-only. no-store (already global).
// The `media` part (roleHint='media') is projected into `media[]`, not `parts[]`.

const router = Router();
const MEDIA_ROLE = 'media';

// Fail-closed secret gate.
router.use((req, res, next) => {
  const expected = process.env.TOUR_CONTENT_EXPORT_SECRET;
  if (!expected) return res.status(500).json({ error: 'export_secret_not_configured' });
  const provided = req.header('x-internal-export-secret') || '';
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(provided ? 403 : 401).json({ error: 'invalid_export_secret' });
  }
  next();
});

// Recruitment integer id → GOS sourceRef.
const tourRef = (id) => `tour:${id}`;
const stationRef = (id) => `station:${id}`;
// GOS sourceRef → recruitment integer id (null if not a recruitment-sourced row).
function sourceIdFrom(sourceRef) {
  const m = /^(?:tour|station):(\d+)$/.exec(sourceRef || '');
  return m ? Number(m[1]) : null;
}

// ── GET /station/:sourceId — full content for one station (by recruitment id) ─────
router.get('/station/:sourceId', handle(async (req, res) => {
  const station = await prisma.tourStation.findUnique({
    where: { sourceRef: stationRef(req.params.sourceId) },
    include: {
      tour: { select: { sourceRef: true, titleHe: true } },
      heroImage: true,
      steps: {
        orderBy: { sortOrder: 'asc' },
        include: { contentBlock: { include: { assets: { where: { active: true }, orderBy: { sortOrder: 'asc' } } } } },
      },
      notes: { orderBy: { sortOrder: 'asc' } },
    },
  });
  if (!station) return res.status(404).json({ error: 'station_not_found' });

  const contentSteps = station.steps.filter((s) => s.roleHint !== MEDIA_ROLE);
  const mediaStep = station.steps.find((s) => s.roleHint === MEDIA_ROLE);

  res.json({
    sourceId: sourceIdFrom(station.sourceRef),
    station: {
      titleHe: station.titleHe,
      descriptionHe: station.descriptionHe,
      active: station.active,
      heroImageUrl: station.heroImage?.url || null,
      heroImageTitle: station.heroImageTitle || null,
    },
    tourSourceId: sourceIdFrom(station.tour?.sourceRef),
    // Ordered content parts. `body` is the same rich content GOS stores.
    parts: contentSteps.map((s) => ({
      roleHint: s.roleHint || null,
      title: s.contentBlock?.titleHe || null,
      body: s.contentBlock?.bodyHe || '',
      notes: s.contentBlock?.internalNote || null,
    })),
    // Media/links (videos, external links, R2 images).
    media: (mediaStep?.contentBlock?.assets || []).map((a) => ({
      assetType: a.assetType,
      language: a.language,
      title: a.titleHe,
      url: a.media?.url || a.url || null,
    })),
    // Admin-only notes (consumer decides visibility; trainee portal must NOT show).
    notes: station.notes.map((n) => ({ content: n.contentHe, order: n.sortOrder })),
    _meta: { source: 'GOS', sourceRef: station.sourceRef },
  });
}));

// ── GET /tour/:sourceId — tour + station skeleton (by recruitment id) ─────────────
router.get('/tour/:sourceId', handle(async (req, res) => {
  const tour = await prisma.tour.findUnique({
    where: { sourceRef: tourRef(req.params.sourceId) },
    include: {
      stations: {
        orderBy: { sortOrder: 'asc' },
        include: { heroImage: { select: { url: true } } },
      },
    },
  });
  if (!tour) return res.status(404).json({ error: 'tour_not_found' });

  res.json({
    sourceId: sourceIdFrom(tour.sourceRef),
    tour: { titleHe: tour.titleHe, descriptionHe: tour.descriptionHe, active: tour.active },
    stations: tour.stations.map((s) => ({
      sourceId: sourceIdFrom(s.sourceRef),
      titleHe: s.titleHe,
      descriptionHe: s.descriptionHe,
      active: s.active,
      sortOrder: s.sortOrder,
      heroImageUrl: s.heroImage?.url || null,
    })),
    _meta: { source: 'GOS', sourceRef: tour.sourceRef },
  });
}));

// ── GET /health — lets recruitment verify connectivity + auth cheaply ─────────────
router.get('/health', handle(async (_req, res) => {
  const [tours, stations] = await Promise.all([prisma.tour.count(), prisma.tourStation.count()]);
  res.json({ ok: true, source: 'GOS', tours, stations });
}));

export default router;
