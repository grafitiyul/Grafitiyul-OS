import express, { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { occupancyFor } from '../tours/occupancy.js';
import { gallerySummary } from '../tours/gallery/service.js';
import {
  startSubmission,
  getSubmission,
  saveDraftAnswers,
  submitSubmission,
  voidSubmission,
  getOrCreatePublicLink,
  sendQError,
} from '../questionnaires/service.js';
import {
  storeQuestionnaireUpload,
  MAX_UPLOAD_BYTES,
} from '../questionnaires/uploads.js';
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
    const profile = await prisma.personProfile.findUnique({
      where: { personRefId: access.person.id },
      select: { imageUrl: true },
    });
    res.set('Cache-Control', 'no-store');
    res.json({
      person: {
        displayName: access.person.displayName,
        imageUrl: profile?.imageUrl || null,
      },
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
    const coordinationStatusByBooking = access.permissions.useCoordinationForms
      ? await coordinationStatuses(tour.bookings.map((b) => b.id))
      : {};
    res.set('Cache-Control', 'no-store');
    res.json(
      guideTourDetailDto({
        tour,
        assignment: access.assignment,
        occupancy: occ[tour.id],
        permissions: access.permissions,
        coordinationStatusByBooking,
      }),
    );
  }),
);

// Active coordination submission per booking (draft/submitted/reviewed).
async function coordinationStatuses(bookingIds) {
  if (!bookingIds.length) return {};
  const rows = await prisma.questionnaireSubmission.findMany({
    where: {
      subjectType: 'booking',
      subjectId: { in: bookingIds },
      purpose: 'coordination',
      status: { in: ['draft', 'submitted', 'reviewed'] },
    },
    select: { subjectId: true, status: true },
  });
  return Object.fromEntries(rows.map((r) => [r.subjectId, r.status]));
}

// ---------- coordination form (per booking) ----------
// The guide opens the SAME public form the customer uses (audience=public) —
// one engine, one flow. This route only mints/returns the capability URL for
// a booking that belongs to a tour the guide is assigned to.

router.post(
  '/:token/tours/:tourEventId/bookings/:bookingId/coordination-link',
  handle(async (req, res) => {
    const access = await resolveGuideTourAccess(prisma, {
      portalToken: req.params.token,
      tourEventId: req.params.tourEventId,
    });
    if (!access.ok) return fail(res, access);
    if (!access.permissions.useCoordinationForms) {
      return res.status(403).json({ error: 'not_allowed' });
    }
    // The booking must belong to THIS tour — the token can never mint links
    // for other tours' bookings.
    const booking = await prisma.booking.findFirst({
      where: { id: String(req.params.bookingId || ''), tourEventId: access.tour.id },
      select: { id: true },
    });
    if (!booking) return res.status(404).json({ error: 'not_found' });
    try {
      const link = await getOrCreatePublicLink({
        purpose: 'coordination',
        subjectType: 'booking',
        subjectId: booking.id,
      });
      res.set('Cache-Control', 'no-store');
      res.json({ url: `/form/${link.token}` });
    } catch (e) {
      return sendQError(res, e);
    }
  }),
);

// ---------- tour summary (questionnaire engine, purpose=tour_summary) ------
// The submission is ALWAYS resolved server-side from (tour_event, tourId) —
// the client never sends a submission id, so a token can only ever touch its
// own tour's summary.

function guideActor(person) {
  return { type: 'staff', ref: null, name: `מדריך · ${person.displayName}` };
}

async function summaryAccess(req, res) {
  const access = await resolveGuideTourAccess(prisma, {
    portalToken: req.params.token,
    tourEventId: req.params.tourEventId,
  });
  if (!access.ok) {
    fail(res, access);
    return null;
  }
  if (!access.permissions.fillTourSummary) {
    res.status(403).json({ error: 'not_allowed' });
    return null;
  }
  return access;
}

async function activeSummarySubmission(tourEventId) {
  return prisma.questionnaireSubmission.findFirst({
    where: {
      subjectType: 'tour_event',
      subjectId: tourEventId,
      purpose: 'tour_summary',
      status: { in: ['draft', 'submitted', 'reviewed'] },
    },
    select: { id: true, status: true, submittedAt: true },
  });
}

// Start-or-resume + full fill payload (same shape the staff dialog reads).
// On a CANCELLED tour an existing submission stays viewable, but a new draft
// is not created.
router.get(
  '/:token/tours/:tourEventId/summary',
  handle(async (req, res) => {
    const access = await summaryAccess(req, res);
    if (!access) return;
    try {
      const existing = await activeSummarySubmission(access.tour.id);
      if (!existing && access.tour.status === 'cancelled') {
        return res.status(409).json({ error: 'tour_cancelled' });
      }
      const { submission } = existing
        ? { submission: existing }
        : await startSubmission({
            purpose: 'tour_summary',
            subjectType: 'tour_event',
            subjectId: access.tour.id,
            actor: guideActor(access.person),
          });
      res.set('Cache-Control', 'no-store');
      res.json(await getSubmission(submission.id));
    } catch (e) {
      return sendQError(res, e);
    }
  }),
);

router.put(
  '/:token/tours/:tourEventId/summary/answers',
  handle(async (req, res) => {
    const access = await summaryAccess(req, res);
    if (!access) return;
    const existing = await activeSummarySubmission(access.tour.id);
    if (!existing) return res.status(404).json({ error: 'submission_not_found' });
    try {
      res.json(await saveDraftAnswers(existing.id, req.body?.answers));
    } catch (e) {
      return sendQError(res, e);
    }
  }),
);

router.post(
  '/:token/tours/:tourEventId/summary/submit',
  handle(async (req, res) => {
    const access = await summaryAccess(req, res);
    if (!access) return;
    const existing = await activeSummarySubmission(access.tour.id);
    if (!existing) return res.status(404).json({ error: 'submission_not_found' });
    try {
      const updated = await submitSubmission(existing.id, {
        answers: req.body?.answers,
        actor: guideActor(access.person),
      });
      res.json({ ok: true, status: updated.status });
    } catch (e) {
      return sendQError(res, e);
    }
  }),
);

// Redo — void frees the singleton slot; history rows stay (engine semantics).
router.post(
  '/:token/tours/:tourEventId/summary/void',
  handle(async (req, res) => {
    const access = await summaryAccess(req, res);
    if (!access) return;
    const existing = await activeSummarySubmission(access.tour.id);
    if (!existing) return res.status(404).json({ error: 'submission_not_found' });
    try {
      res.json(await voidSubmission(existing.id));
    } catch (e) {
      return sendQError(res, e);
    }
  }),
);

// Answer attachment upload — same engine limits as the staff/public routes.
router.post(
  '/:token/tours/:tourEventId/summary/upload',
  express.raw({ type: '*/*', limit: `${Math.ceil(MAX_UPLOAD_BYTES / 1024 / 1024) + 1}mb` }),
  handle(async (req, res) => {
    const access = await summaryAccess(req, res);
    if (!access) return;
    try {
      res.status(201).json(await storeQuestionnaireUpload(req.body, req.query.filename));
    } catch (e) {
      return sendQError(res, e);
    }
  }),
);

// ---------- סיכום סיור section status (summary + gallery, one call) --------

router.get(
  '/:token/tours/:tourEventId/summary-status',
  handle(async (req, res) => {
    const access = await resolveGuideTourAccess(prisma, {
      portalToken: req.params.token,
      tourEventId: req.params.tourEventId,
    });
    if (!access.ok) return fail(res, access);
    const [summary, gallery] = await Promise.all([
      access.permissions.fillTourSummary
        ? activeSummarySubmission(access.tour.id)
        : Promise.resolve(null),
      access.permissions.useTourGallery
        ? gallerySummary(prisma, access.tour.id)
        : Promise.resolve(null),
    ]);
    res.set('Cache-Control', 'no-store');
    res.json({
      summary: summary ? { status: summary.status, submittedAt: summary.submittedAt } : null,
      summaryAllowed: access.permissions.fillTourSummary,
      gallery: gallery
        ? {
            imageCount: gallery.imageCount,
            videoCount: gallery.videoCount,
            status: gallery.status,
          }
        : null,
      galleryAllowed: access.permissions.useTourGallery,
      tourStatus: access.tour.status,
    });
  }),
);

export default router;
