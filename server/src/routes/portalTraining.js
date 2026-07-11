import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { resolveGuidePortalAccess } from '../tours/guidePortal/access.js';

// Guide Portal → מערכי הדרכה. Token-gated read access to training content
// (the Tour → Station content domain), enforced by TWO server-side gates:
//   1. the viewTraining portal permission (global switch), and
//   2. an explicit GuideStationAccess row per station — a guide sees ONLY
//      stations an admin granted, and a direct station URL without a grant
//      is 403 (guessing ids gains nothing).
//
// Content stays in its source of truth (tour-content module); this router
// only projects a learner-safe read model: content parts + media, hero — and
// NEVER admin annotations (TourStationNote) or block internalNote.

const router = Router();

function fail(res, r) {
  return res.status(r.status).json({ error: r.error });
}

async function trainingAccess(req, res) {
  const access = await resolveGuidePortalAccess(prisma, {
    portalToken: req.params.token,
  });
  if (!access.ok) {
    fail(res, access);
    return null;
  }
  if (!access.permissions.viewTraining) {
    res.status(403).json({ error: 'not_allowed' });
    return null;
  }
  return access;
}

const MEDIA_ROLE = 'media';

// Permitted tours + stations only — both list AND content are filtered
// server-side; the API never returns an unpermitted station.
router.get(
  '/:token/training',
  handle(async (req, res) => {
    const access = await trainingAccess(req, res);
    if (!access) return;
    const grants = await prisma.guideStationAccess.findMany({
      where: { personRefId: access.person.id },
      select: { stationId: true },
    });
    const grantedIds = grants.map((g) => g.stationId);
    if (grantedIds.length === 0) {
      res.set('Cache-Control', 'no-store');
      return res.json({ tours: [] });
    }
    const stations = await prisma.tourStation.findMany({
      where: { id: { in: grantedIds }, active: true, tour: { active: true } },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        titleHe: true,
        descriptionHe: true,
        kind: true,
        sortOrder: true,
        heroImage: { select: { url: true } },
        tour: { select: { id: true, titleHe: true, descriptionHe: true, sortOrder: true } },
      },
    });
    const byTour = new Map();
    for (const s of stations) {
      if (!byTour.has(s.tour.id)) {
        byTour.set(s.tour.id, {
          id: s.tour.id,
          titleHe: s.tour.titleHe,
          descriptionHe: s.tour.descriptionHe || null,
          sortOrder: s.tour.sortOrder,
          stations: [],
        });
      }
      byTour.get(s.tour.id).stations.push({
        id: s.id,
        titleHe: s.titleHe,
        descriptionHe: s.descriptionHe || null,
        kind: s.kind,
        heroImageUrl: s.heroImage?.url || null,
      });
    }
    const tours = [...byTour.values()].sort((a, b) => a.sortOrder - b.sortOrder);
    for (const t of tours) delete t.sortOrder;
    res.set('Cache-Control', 'no-store');
    res.json({ tours });
  }),
);

// One station's learner-safe content. Requires an explicit grant row.
router.get(
  '/:token/training/stations/:stationId',
  handle(async (req, res) => {
    const access = await trainingAccess(req, res);
    if (!access) return;
    const stationId = String(req.params.stationId || '');
    const grant = await prisma.guideStationAccess.findUnique({
      where: { stationId_personRefId: { stationId, personRefId: access.person.id } },
    });
    if (!grant) return res.status(403).json({ error: 'not_allowed' });

    const station = await prisma.tourStation.findFirst({
      where: { id: stationId, active: true, tour: { active: true } },
      include: {
        tour: { select: { id: true, titleHe: true } },
        heroImage: { select: { url: true } },
        steps: {
          orderBy: { sortOrder: 'asc' },
          include: {
            contentBlock: {
              include: {
                assets: {
                  where: { active: true },
                  orderBy: { sortOrder: 'asc' },
                  include: { media: { select: { url: true } } },
                },
              },
            },
          },
        },
      },
    });
    if (!station) return res.status(404).json({ error: 'not_found' });

    const visibleSteps = station.steps.filter((s) => s.isVisible !== false);
    const contentSteps = visibleSteps.filter((s) => s.roleHint !== MEDIA_ROLE);
    const mediaStep = visibleSteps.find((s) => s.roleHint === MEDIA_ROLE);

    res.set('Cache-Control', 'no-store');
    res.json({
      id: station.id,
      titleHe: station.titleHe,
      descriptionHe: station.descriptionHe || null,
      heroImageUrl: station.heroImage?.url || null,
      heroImageTitle: station.heroImageTitle || null,
      tour: { id: station.tour.id, titleHe: station.tour.titleHe },
      // Ordered content parts — rich HTML rendered by the canonical stack.
      // internalNote / station notes are admin-only and NEVER shipped here.
      parts: contentSteps.map((s) => ({
        title: s.contentBlock?.titleHe || null,
        body: s.contentBlock?.bodyHe || '',
      })),
      media: (mediaStep?.contentBlock?.assets || []).map((a) => ({
        assetType: a.assetType,
        title: a.titleHe,
        url: a.media?.url || a.url || null,
      })),
    });
  }),
);

export default router;
