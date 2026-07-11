import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { occupancyFor } from '../tours/occupancy.js';
import {
  resolveGuidePortalAccess,
  resolveGuideTourAccess,
} from '../tours/guidePortal/access.js';
import {
  guideTourCardDto,
  guideTourDetailDto,
  tourEndMs,
} from '../tours/guidePortal/dto.js';

// Guide Portal → Tours. Mounted at /api/portal alongside the task feed and
// gallery routers; the portal token IS the credential (same V1 model).
//
// DTO CONTRACT: every payload leaving this router is built by
// tours/guidePortal/dto.js — dedicated read models, permission-gated on the
// server. No raw Deal/Booking objects, no deal ids, no commercial data.

const router = Router();

function fail(res, r) {
  return res.status(r.status).json({ error: r.error });
}

// Sanity cap for the past list — the portal is an operational app, not an
// archive browser. Newest-first, so the cap drops only ancient history.
const PAST_LIMIT = 200;

// ---------- portal home (shell bootstrap) ----------
// The client uses `permissions` to decide which tabs/menu entries to render.
// That is CONVENIENCE ONLY — every data route below re-resolves and enforces
// the same permissions server-side.

router.get(
  '/:token/home',
  handle(async (req, res) => {
    const access = await resolveGuidePortalAccess(prisma, {
      portalToken: req.params.token,
    });
    if (!access.ok) return fail(res, access);
    res.set('Cache-Control', 'no-store');
    res.json({
      person: { displayName: access.person.displayName },
      permissions: access.permissions,
    });
  }),
);

// ---------- tours feed ----------

const CARD_TOUR_INCLUDE = {
  product: { select: { nameHe: true } },
  location: { select: { nameHe: true } },
  productVariant: {
    select: {
      durationHours: true,
      location: { select: { nameHe: true } },
    },
  },
};

async function loadAssignedTours(person) {
  return prisma.tourAssignment.findMany({
    where: { externalPersonId: person.externalPersonId },
    include: { tourEvent: { include: CARD_TOUR_INCLUDE } },
  });
}

async function cardsFor(assignments) {
  const ids = assignments.map((a) => a.tourEventId);
  const occ = ids.length ? await occupancyFor(prisma, ids) : {};
  return assignments.map((a) =>
    guideTourCardDto({
      tour: a.tourEvent,
      assignment: a,
      occupancy: occ[a.tourEventId],
    }),
  );
}

function sortKey(card) {
  return `${card.date} ${card.startTime}`;
}

// Upcoming = not ended yet (a tour running right now still shows). Includes
// cancelled future tours — the client renders them with a clear cancelled
// state instead of silently dropping them from the guide's plan.
router.get(
  '/:token/tours/upcoming',
  handle(async (req, res) => {
    const access = await resolveGuidePortalAccess(prisma, {
      portalToken: req.params.token,
    });
    if (!access.ok) return fail(res, access);
    const now = Date.now();
    const assignments = (await loadAssignedTours(access.person)).filter((a) => {
      const end = tourEndMs(a.tourEvent);
      return Number.isNaN(end) ? true : end >= now;
    });
    const tours = (await cardsFor(assignments)).sort((x, y) =>
      sortKey(x).localeCompare(sortKey(y)),
    );
    res.set('Cache-Control', 'no-store');
    res.json({ tours });
  }),
);

// Past = end time in the past. Newest first. Server-gated on viewPastTours.
router.get(
  '/:token/tours/past',
  handle(async (req, res) => {
    const access = await resolveGuidePortalAccess(prisma, {
      portalToken: req.params.token,
    });
    if (!access.ok) return fail(res, access);
    if (!access.permissions.viewPastTours) {
      return res.status(403).json({ error: 'not_allowed' });
    }
    const now = Date.now();
    const assignments = (await loadAssignedTours(access.person)).filter((a) => {
      const end = tourEndMs(a.tourEvent);
      return Number.isNaN(end) ? false : end < now;
    });
    const tours = (await cardsFor(assignments))
      .sort((x, y) => sortKey(y).localeCompare(sortKey(x)))
      .slice(0, PAST_LIMIT);
    res.set('Cache-Control', 'no-store');
    res.json({ tours });
  }),
);

// ---------- tour detail ----------
// The guide's read-only operational view. Requires an assignment on THIS
// tour; cancelled/past tours still resolve (clear state, summary, gallery).

router.get(
  '/:token/tours/:tourEventId/detail',
  handle(async (req, res) => {
    const access = await resolveGuideTourAccess(prisma, {
      portalToken: req.params.token,
      tourEventId: req.params.tourEventId,
    });
    if (!access.ok) return fail(res, access);
    // Past tours are reachable directly by URL — same permission as the tab.
    const tour = await prisma.tourEvent.findUnique({
      where: { id: access.tour.id },
      include: {
        product: { select: { nameHe: true } },
        location: { select: { nameHe: true } },
        productVariant: {
          select: {
            durationHours: true,
            location: { select: { nameHe: true } },
          },
        },
        assignments: {
          orderBy: { createdAt: 'asc' },
          include: {
            personRef: { select: { profile: { select: { imageUrl: true } } } },
          },
        },
        activityComponents: {
          orderBy: { sortOrder: 'asc' },
          include: { activityComponent: true, workshopLocation: true },
        },
        bookings: {
          orderBy: { createdAt: 'asc' },
          include: {
            deal: {
              // Guide-safe whitelist — NO id-based navigation, NO commercial
              // fields. orderNo is display-only by contract.
              select: {
                orderNo: true,
                title: true,
                customerInfo: true,
                organization: { select: { name: true } },
                organizationUnit: { select: { name: true } },
                contacts: {
                  orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
                  select: {
                    roles: true,
                    isPrimary: true,
                    contact: {
                      select: {
                        firstNameHe: true,
                        lastNameHe: true,
                        firstNameEn: true,
                        lastNameEn: true,
                        phones: { where: { isPrimary: true }, take: 1, select: { value: true } },
                        emails: { where: { isPrimary: true }, take: 1, select: { value: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!tour) return res.status(404).json({ error: 'not_found' });
    if (tourEndMs(tour) < Date.now() && !access.permissions.viewPastTours) {
      return res.status(403).json({ error: 'not_allowed' });
    }
    const occ = await occupancyFor(prisma, [tour.id]);
    res.set('Cache-Control', 'no-store');
    res.json(
      guideTourDetailDto({
        tour,
        assignment: access.assignment,
        occupancy: occ[tour.id],
        permissions: access.permissions,
      }),
    );
  }),
);

export default router;
