import { Router } from 'express';
import { prisma } from '../db.js';
import { catalogTitle, pickBilingual } from '../../../shared/bilingualText.mjs';
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
      return res.json({ language: access.language, tours: [] });
    }
    const stations = await prisma.tourStation.findMany({
      where: { id: { in: grantedIds }, active: true, tour: { active: true } },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        titleHe: true,
        descriptionHe: true,
        titleEn: true,
        descriptionEn: true,
        kind: true,
        sortOrder: true,
        heroImage: { select: { url: true } },
        tour: {
          select: {
            id: true,
            titleHe: true,
            descriptionHe: true,
            titleEn: true,
            descriptionEn: true,
            sortOrder: true,
          },
        },
      },
    });
    const lang = access.language;
    const byTour = new Map();
    for (const s of stations) {
      if (!byTour.has(s.tour.id)) {
        byTour.set(s.tour.id, {
          id: s.tour.id,
          // Resolved to the guide's language through the ONE bilingual picker;
          // the client never sees a language-specific key.
          title: catalogTitle(s.tour, lang),
          description: pickBilingual({ he: s.tour.descriptionHe, en: s.tour.descriptionEn }, lang) || null,
          sortOrder: s.tour.sortOrder,
          stations: [],
        });
      }
      byTour.get(s.tour.id).stations.push({
        id: s.id,
        title: catalogTitle(s, lang),
        description: pickBilingual({ he: s.descriptionHe, en: s.descriptionEn }, lang) || null,
        kind: s.kind,
        heroImageUrl: s.heroImage?.url || null,
      });
    }
    const tours = [...byTour.values()].sort((a, b) => a.sortOrder - b.sortOrder);
    for (const t of tours) delete t.sortOrder;
    res.set('Cache-Control', 'no-store');
    // Training content is now fully bilingual (Tour/TourStation/
    // TourContentBlock/TourBlockAsset each carry an English twin). Every value
    // above is already resolved to the guide's language; `language` travels so
    // the page CHROME comes from the portal registry.
    res.json({ language: access.language, tours });
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
        tour: { select: { id: true, titleHe: true, titleEn: true } },
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
    const lang = access.language;
    res.json({
      language: lang,
      id: station.id,
      // All station content resolves through the ONE bilingual picker. Where
      // English has not been written yet the authored Hebrew shows — a DATA
      // gap listed by the coverage report, never translated at runtime.
      title: catalogTitle(station, lang),
      description: pickBilingual({ he: station.descriptionHe, en: station.descriptionEn }, lang) || null,
      heroImageUrl: station.heroImage?.url || null,
      heroImageTitle:
        pickBilingual({ he: station.heroImageTitle, en: station.heroImageTitleEn }, lang) || null,
      tour: { id: station.tour.id, title: catalogTitle(station.tour, lang) },
      // Ordered content parts — rich HTML rendered by the canonical stack.
      // roleHint drives the accordion grouping (build_up / curiosity_hook /
      // content / punchline). internalNote / station notes are admin-only
      // and NEVER shipped here.
      parts: contentSteps.map((step) => ({
        roleHint: step.roleHint || null,
        title: catalogTitle(step.contentBlock, lang) || null,
        body: pickBilingual({ he: step.contentBlock?.bodyHe, en: step.contentBlock?.bodyEn }, lang) || '',
      })),
      media: (mediaStep?.contentBlock?.assets || []).map((a) => ({
        assetType: a.assetType,
        title: catalogTitle(a, lang),
        url: a.media?.url || a.url || null,
      })),
    });
  }),
);

export default router;
