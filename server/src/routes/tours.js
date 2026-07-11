import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import {
  GROUP_SLOT_REQUIRED_FIELDS,
  SCHEDULE_RULE_REQUIRED_FIELDS,
  TOUR_EVENT_STATUSES,
  TOUR_LANGS,
  DATE_RE,
  TIME_RE,
  missingFields,
} from '../tours/requiredFields.js';
import { ensureGeneratedSlots, getTourSettings } from '../tours/slotGeneration.js';
import { occupancyFor } from '../tours/occupancy.js';
import {
  cancelDealBooking,
  reconnectOrphanBooking,
} from '../tours/tourFromDeal.js';
import { recordDealChanges, DEAL_DIFF_SELECT } from '../timeline/dealChangelog.js';
import { emitTimelineEvent, userOrigin } from '../timeline/events.js';
import { validateWorkshopLocationForComponent } from '../tours/activityCatalog.js';
import { seedTourComponents } from '../tours/tourComponents.js';
import { scheduleGalleryCleanup } from '../tours/gallery/service.js';
import { summaryCompletionState, completeTour, reopenTour } from '../tours/completion.js';
import { isAssignableStaff } from '../people/eligibility.js';
import { resolveTourGuideColor } from '../../../shared/guideColor.mjs';
import {
  calendarPendingPatch,
  patchTouchesCalendar,
  markTourCalendarPending,
  scheduleCalendarTombstone,
  kickTourCalendarSync,
} from '../tours/calendar/service.js';

// TourEvent CRUD — the OPERATIONAL tours module ("סיורים"). Distinct from the
// tour CONTENT routes (/api/tour-content). Ownership contract:
//   * group_slot tours are fully editable here (they are created/managed on
//     the Tours screen and exist before any deal);
//   * private/business tours mirror their deal's planning fields — those are
//     edited on the DEAL (the planning source of truth) and synced by the WON
//     module, so this router only allows operational fields (status, notes)
//     on them. Rejecting the rest here is what keeps one source of truth.
// Occupancy is always derived via occupancyFor — never stored.

const router = Router();

const TOUR_INCLUDE = {
  product: { select: { id: true, nameHe: true, nameEn: true } },
  productVariant: {
    select: {
      id: true,
      locationId: true,
      location: { select: { id: true, nameHe: true } },
      durationHours: true,
    },
  },
  location: { select: { id: true, nameHe: true } },
};

function toClientTour(t, occ) {
  const o = occ || { activeSeats: 0, activeBookings: 0, totalBookings: 0 };
  return { ...t, ...o };
}

// Assignment rows → the { role, color } shape the canonical guide-color
// resolver consumes (shared/guideColor.mjs — ONE rule for every surface).
function toColorAssignments(assignments) {
  return (assignments || []).map((a) => ({
    role: a.role,
    color: a.personRef?.profile?.displayColor || null,
  }));
}

// Minimal select for deriving guideColor without shipping profiles.
const GUIDE_COLOR_ASSIGNMENT_SELECT = {
  tourEventId: true,
  role: true,
  personRef: { select: { profile: { select: { displayColor: true } } } },
};

// One query for a set of tours → { [tourEventId]: paletteKey | null }.
async function guideColorsFor(tourEventIds) {
  const ids = [...new Set(tourEventIds)].filter(Boolean);
  if (!ids.length) return {};
  const rows = await prisma.tourAssignment.findMany({
    where: { tourEventId: { in: ids } },
    select: GUIDE_COLOR_ASSIGNMENT_SELECT,
  });
  const byTour = new Map();
  for (const r of rows) {
    if (!byTour.has(r.tourEventId)) byTour.set(r.tourEventId, []);
    byTour.get(r.tourEventId).push(r);
  }
  const out = {};
  for (const id of ids) {
    out[id] = resolveTourGuideColor(toColorAssignments(byTour.get(id)));
  }
  return out;
}

// Shared field validation for create/update of group slots. Mutates `data`
// only for keys present in `b`. EMPTY values are written as null and left for
// the declarative missing-fields gate to report (a friendly 422 checklist);
// only malformed NON-empty values return a hard error code here.
function applySlotFields(b, data) {
  if (b.date !== undefined) {
    if (b.date && !DATE_RE.test(String(b.date))) return 'invalid_date';
    data.date = b.date ? String(b.date) : null;
  }
  if (b.startTime !== undefined) {
    if (b.startTime && !TIME_RE.test(String(b.startTime))) return 'invalid_time';
    data.startTime = b.startTime ? String(b.startTime) : null;
  }
  if (b.tourLanguage !== undefined) {
    if (b.tourLanguage && !TOUR_LANGS.includes(b.tourLanguage)) return 'invalid_tour_language';
    data.tourLanguage = b.tourLanguage || null;
  }
  if (b.capacity !== undefined) {
    if (b.capacity === null || b.capacity === '') {
      data.capacity = null;
    } else {
      const n = Number(b.capacity);
      if (!Number.isInteger(n) || n < 1) return 'invalid_capacity';
      data.capacity = n;
    }
  }
  if (b.notes !== undefined) data.notes = b.notes ? String(b.notes) : null;
  return null;
}

// Resolve + verify the product/variant pair; the slot's city ALWAYS derives
// from the variant (workshop location is out of scope by product decision).
async function resolveVariant(productId, productVariantId) {
  const variant = await prisma.productVariant.findUnique({
    where: { id: productVariantId },
    select: { id: true, productId: true, locationId: true },
  });
  if (!variant || variant.productId !== productId) return null;
  return variant;
}

// ---------- list ----------

router.get(
  '/',
  handle(async (req, res) => {
    // Sync-on-read: materialize any group slots that entered the horizon
    // since the last read (idempotent — cursor + unique guard, see
    // slotGeneration.js). Never blocks the list on a generation hiccup.
    try {
      await ensureGeneratedSlots(prisma);
    } catch (e) {
      console.error('[tours] slot generation failed', e);
    }
    const where = {};
    if (req.query.kind) where.kind = String(req.query.kind);
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.dateFrom || req.query.dateTo) {
      where.date = {
        ...(req.query.dateFrom ? { gte: String(req.query.dateFrom) } : {}),
        ...(req.query.dateTo ? { lte: String(req.query.dateTo) } : {}),
      };
    }
    const tours = await prisma.tourEvent.findMany({
      where,
      include: TOUR_INCLUDE,
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    });
    const [occ, guideColors] = await Promise.all([
      occupancyFor(prisma, tours.map((t) => t.id)),
      guideColorsFor(tours.map((t) => t.id)),
    ]);
    res.json(
      tours.map((t) => ({
        ...toClientTour(t, occ[t.id]),
        // Derived guide identity accent (canonical rule) — no assignment
        // rows or profiles ride the list payload.
        guideColor: guideColors[t.id] || null,
      })),
    );
  }),
);

// ---------- calendar (read-only date-range view) ----------
// The Admin calendar is a VIEW of the same TourEvents as the table — one lean
// DTO per event derived from existing relations. No Deal payloads, no N+1
// (occupancy is one groupBy; team/components ride the include), and only the
// VISIBLE range is queried (≤ one month grid incl. leading/trailing days).
// Status filter shares the table's vocabulary; cancelled is excluded unless
// explicitly requested. Postponed tours have no date, so they never occupy a
// dated slot by construction. Registered before '/:id'.

const CALENDAR_MAX_SPAN_DAYS = 62;

router.get(
  '/calendar',
  handle(async (req, res) => {
    try {
      await ensureGeneratedSlots(prisma); // same sync-on-read as the list
    } catch (e) {
      console.error('[tours] slot generation failed', e);
    }
    const from = String(req.query.from || '');
    const to = String(req.query.to || '');
    if (!DATE_RE.test(from) || !DATE_RE.test(to) || to < from) {
      return res.status(400).json({ error: 'invalid_range' });
    }
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > CALENDAR_MAX_SPAN_DAYS) {
      return res.status(400).json({ error: 'range_too_large' });
    }
    const where = { date: { gte: from, lte: to } };
    const status = String(req.query.status || 'active');
    if (status === 'active') where.status = { in: ['scheduled', 'postponed'] };
    else if (status !== 'all') {
      if (!TOUR_EVENT_STATUSES.includes(status)) {
        return res.status(400).json({ error: 'invalid_status' });
      }
      where.status = status;
    }
    if (req.query.kind) where.kind = String(req.query.kind);
    const tours = await prisma.tourEvent.findMany({
      where,
      select: {
        id: true, kind: true, status: true, date: true, startTime: true,
        tourLanguage: true, capacity: true, notes: true,
        product: { select: { nameHe: true } },
        location: { select: { nameHe: true } },
        productVariant: {
          select: { durationHours: true, location: { select: { nameHe: true } } },
        },
        assignments: {
          select: {
            displayName: true,
            role: true,
            personRef: { select: { profile: { select: { displayColor: true } } } },
          },
        },
        activityComponents: {
          orderBy: { sortOrder: 'asc' },
          select: { activityComponent: { select: { nameHe: true, icon: true } } },
        },
      },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    });
    const occ = await occupancyFor(prisma, tours.map((t) => t.id));
    res.set('Cache-Control', 'no-store');
    res.json({
      events: tours.map((t) => {
        const o = occ[t.id] || { activeSeats: 0, activeBookings: 0 };
        const lead = t.assignments.find((a) => a.role === 'lead_guide');
        return {
          id: t.id,
          kind: t.kind,
          status: t.status,
          date: t.date,
          startTime: t.startTime,
          durationHours: t.productVariant?.durationHours ?? null,
          productName: t.product?.nameHe || null,
          city: t.location?.nameHe || t.productVariant?.location?.nameHe || null,
          tourLanguage: t.tourLanguage,
          participants: o.activeSeats,
          capacity: t.capacity,
          notes: t.notes,
          leadGuideName: lead?.displayName || null,
          teamCount: t.assignments.length,
          // Guide identity accent — canonical rule (shared/guideColor.mjs).
          guideColor: resolveTourGuideColor(toColorAssignments(t.assignments)),
          components: t.activityComponents
            .map((c) => c.activityComponent?.nameHe)
            .filter(Boolean),
        };
      }),
    });
  }),
);

// ---------- scheduling (Settings → Tours) ----------
// Global settings singleton + recurring weekly rules. Registered BEFORE
// '/:id'. Rule mutations trigger immediate generation so the tours list
// reflects the schedule without waiting for the next read.

const WEEKDAY_MIN = 0;
const WEEKDAY_MAX = 6;

function validateRuleFields(b, data) {
  if (b.weekday !== undefined) {
    const w = Number(b.weekday);
    if (!Number.isInteger(w) || w < WEEKDAY_MIN || w > WEEKDAY_MAX) return 'invalid_weekday';
    data.weekday = w;
  }
  if (b.startTime !== undefined) {
    if (!TIME_RE.test(String(b.startTime || ''))) return 'invalid_time';
    data.startTime = String(b.startTime);
  }
  if (b.tourLanguage !== undefined) {
    if (!TOUR_LANGS.includes(b.tourLanguage)) return 'invalid_tour_language';
    data.tourLanguage = b.tourLanguage;
  }
  if (b.capacity !== undefined) {
    const n = Number(b.capacity);
    if (!Number.isInteger(n) || n < 1) return 'invalid_capacity';
    data.capacity = n;
  }
  if (b.active !== undefined) data.active = !!b.active;
  return null;
}

const RULE_INCLUDE = {
  product: { select: { id: true, nameHe: true } },
  productVariant: {
    select: { id: true, location: { select: { id: true, nameHe: true } } },
  },
};

router.get(
  '/scheduling',
  handle(async (_req, res) => {
    const [settings, rules] = await Promise.all([
      getTourSettings(prisma),
      prisma.tourScheduleRule.findMany({
        orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
        include: RULE_INCLUDE,
      }),
    ]);
    res.json({ settings, rules });
  }),
);

router.put(
  '/scheduling/settings',
  handle(async (req, res) => {
    const b = req.body || {};
    const data = {};
    if (b.defaultCapacity !== undefined) {
      const n = Number(b.defaultCapacity);
      if (!Number.isInteger(n) || n < 1) return res.status(400).json({ error: 'invalid_capacity' });
      data.defaultCapacity = n;
    }
    if (b.generateDaysAhead !== undefined) {
      const n = Number(b.generateDaysAhead);
      if (!Number.isInteger(n) || n < 0 || n > 366) {
        return res.status(400).json({ error: 'invalid_days_ahead' });
      }
      data.generateDaysAhead = n;
    }
    await getTourSettings(prisma); // ensure the singleton exists
    const settings = await prisma.tourSettings.update({ where: { id: 'singleton' }, data });
    // A larger horizon should materialize immediately.
    try {
      await ensureGeneratedSlots(prisma);
    } catch (e) {
      console.error('[tours] slot generation failed', e);
    }
    res.json(settings);
  }),
);

router.post(
  '/scheduling/rules',
  handle(async (req, res) => {
    const b = req.body || {};
    const missing = missingFields(b, SCHEDULE_RULE_REQUIRED_FIELDS);
    if (missing.length) {
      return res.status(422).json({ error: 'missing_required_fields', missing });
    }
    const data = {};
    const fieldErr = validateRuleFields(b, data);
    if (fieldErr) return res.status(400).json({ error: fieldErr });
    const variant = await resolveVariant(b.productId, b.productVariantId);
    if (!variant) return res.status(400).json({ error: 'invalid_product_variant' });
    data.productId = b.productId;
    data.productVariantId = variant.id;

    const rule = await prisma.tourScheduleRule.create({ data, include: RULE_INCLUDE });
    try {
      await ensureGeneratedSlots(prisma);
    } catch (e) {
      console.error('[tours] slot generation failed', e);
    }
    res.status(201).json(rule);
  }),
);

router.put(
  '/scheduling/rules/:ruleId',
  handle(async (req, res) => {
    const b = req.body || {};
    const existing = await prisma.tourScheduleRule.findUnique({
      where: { id: req.params.ruleId },
    });
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const data = {};
    const fieldErr = validateRuleFields(b, data);
    if (fieldErr) return res.status(400).json({ error: fieldErr });
    if (b.productId !== undefined || b.productVariantId !== undefined) {
      const productId = b.productId ?? existing.productId;
      const productVariantId = b.productVariantId ?? existing.productVariantId;
      const variant = await resolveVariant(productId, productVariantId);
      if (!variant) return res.status(400).json({ error: 'invalid_product_variant' });
      data.productId = productId;
      data.productVariantId = variant.id;
    }
    // Recipe changes apply to FUTURE generation only — already-created slots
    // are real TourEvents and stay as they are (edited individually if needed).
    // Reactivating or rescheduling resumes from the existing cursor.
    const rule = await prisma.tourScheduleRule.update({
      where: { id: existing.id },
      data,
      include: RULE_INCLUDE,
    });
    try {
      await ensureGeneratedSlots(prisma);
    } catch (e) {
      console.error('[tours] slot generation failed', e);
    }
    res.json(rule);
  }),
);

router.delete(
  '/scheduling/rules/:ruleId',
  handle(async (req, res) => {
    // Already-generated slots survive (loose generatedByRuleId ref) — deleting
    // a rule only stops FUTURE generation.
    await prisma.tourScheduleRule.delete({ where: { id: req.params.ruleId } });
    res.status(204).end();
  }),
);

// ---------- orphans ----------
// Orphaned bookings = tours intentionally kept when their deal left WON.
// Product rule: they must never be hidden — the app header shows a permanent
// warning while any exist, and this queue is where they get resolved
// (reconnect to the re-won deal, or cancel). Registered BEFORE '/:id'.

router.get(
  '/orphans/count',
  handle(async (_req, res) => {
    const count = await prisma.booking.count({ where: { status: 'orphaned' } });
    res.json({ count });
  }),
);

router.get(
  '/orphans',
  handle(async (_req, res) => {
    const orphans = await prisma.booking.findMany({
      where: { status: 'orphaned' },
      orderBy: { orphanedAt: 'asc' },
      include: {
        tourEvent: {
          select: {
            id: true,
            kind: true,
            status: true,
            date: true,
            startTime: true,
            product: { select: { id: true, nameHe: true } },
            location: { select: { id: true, nameHe: true } },
          },
        },
        deal: {
          select: {
            id: true,
            orderNo: true,
            title: true,
            status: true,
            organization: { select: { id: true, name: true } },
          },
        },
      },
    });
    res.json(orphans);
  }),
);

// Reconnect the orphan to its original deal (requires the deal WON again and
// free of other tours). Group slots stay authoritative — their fields re-sync
// onto the deal with a changelog entry per field.
router.post(
  '/orphans/:bookingId/reconnect',
  handle(async (req, res) => {
    const booking = await prisma.booking.findUnique({
      where: { id: req.params.bookingId },
      include: { tourEvent: true },
    });
    if (!booking) return res.status(404).json({ error: 'not_found' });
    if (booking.status !== 'orphaned') return res.status(409).json({ error: 'not_orphaned' });

    const before = await prisma.deal.findUnique({
      where: { id: booking.dealId },
      select: { ...DEAL_DIFF_SELECT, productVariantId: true },
    });
    const origin = await userOrigin(req.adminAuth?.userId);
    try {
      await prisma.$transaction(async (tx) => {
        const { dealSync } = await reconnectOrphanBooking(tx, booking, { origin });
        if (dealSync) {
          await tx.deal.update({ where: { id: booking.dealId }, data: dealSync });
        }
      });
    } catch (e) {
      if (e.code === 'deal_not_won' || e.code === 'deal_already_on_tour') {
        return res.status(409).json({ error: e.code });
      }
      throw e;
    }
    const after = await prisma.deal.findUnique({
      where: { id: booking.dealId },
      select: { ...DEAL_DIFF_SELECT, productVariantId: true },
    });
    await recordDealChanges(prisma, { dealId: booking.dealId, before, after, origin });
    res.json({ ok: true });
  }),
);

// Cancel the orphan tour participation. Reuses the ONE booking-cancellation
// path (timeline events + auto-cancel of an empty private/business tour).
router.post(
  '/orphans/:bookingId/cancel',
  handle(async (req, res) => {
    const booking = await prisma.booking.findUnique({
      where: { id: req.params.bookingId },
      include: { tourEvent: true },
    });
    if (!booking) return res.status(404).json({ error: 'not_found' });
    if (booking.status !== 'orphaned') return res.status(409).json({ error: 'not_orphaned' });
    const origin = await userOrigin(req.adminAuth?.userId);
    await prisma.$transaction(async (tx) => {
      await cancelDealBooking(tx, booking, { reason: 'orphan_cancelled', origin });
    });
    res.json({ ok: true });
  }),
);

// ── explicit tour completion (tours/completion.js is the ONE transition) ────

// Confirmation-dialog payload for "סמן סיור כהסתיים": which required guides
// (lead_guide/guide) still owe their summary. Also feeds the summary section.
router.get(
  '/:id/completion-state',
  handle(async (req, res) => {
    const tour = await prisma.tourEvent.findUnique({
      where: { id: req.params.id },
      select: { id: true, status: true, completedAt: true, completedReason: true },
    });
    if (!tour) return res.status(404).json({ error: 'not_found' });
    const state = await summaryCompletionState(prisma, tour.id);
    res.set('Cache-Control', 'no-store');
    res.json({
      status: tour.status,
      completedAt: tour.completedAt,
      completedReason: tour.completedReason,
      required: state.required,
      missing: state.missing.map((m) => ({ displayName: m.displayName, role: m.role })),
    });
  }),
);

// Manual completion (trigger #3). Idempotent; refuses cancelled tours and —
// server-enforced — any day that is not the tour's own date (not_tour_day).
router.post(
  '/:id/complete',
  handle(async (req, res) => {
    const origin = await userOrigin(req.adminAuth?.userId);
    const result = await completeTour(prisma, req.params.id, {
      reason: 'manual',
      actorName: origin.createdByName || null,
    });
    if (!result.ok) {
      return res.status(result.error === 'not_found' ? 404 : 409).json({ error: result.error });
    }
    res.json({ ok: true, already: !!result.already });
  }),
);

// Completion REVERSAL ("החזר לעתידי") — completion.js is the ONE transition
// pair. Only completed tours whose date is today/future may reopen; the
// service also unfreezes the questionnaires this completion froze and marks
// the calendar row pending (same gcalEventId — never a duplicate event).
router.post(
  '/:id/reopen',
  handle(async (req, res) => {
    const origin = await userOrigin(req.adminAuth?.userId);
    const result = await reopenTour(prisma, req.params.id, {
      actorName: origin.createdByName || null,
    });
    if (!result.ok) {
      return res.status(result.error === 'not_found' ? 404 : 409).json({ error: result.error });
    }
    kickTourCalendarSync();
    res.json({ ok: true });
  }),
);

// Tour page payload. Customer information is READ-THROUGH from each booking's
// Deal (organization / contacts / customerInfo) — never copied onto the tour.
// fieldRep / ordering-contact resolution happens client-side from the roles.
router.get(
  '/:id',
  handle(async (req, res) => {
    const tour = await prisma.tourEvent.findUnique({
      where: { id: req.params.id },
      include: {
        ...TOUR_INCLUDE,
        assignments: {
          orderBy: { createdAt: 'asc' },
          include: {
            personRef: {
              select: {
                id: true,
                displayName: true,
                status: true,
                lifecycleHint: true,
                // Staff photo + identity color for the team chips
                // (read-through; PersonProfile is owned by the people module).
                profile: { select: { imageUrl: true, displayColor: true } },
              },
            },
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
              select: {
                id: true,
                orderNo: true,
                title: true,
                status: true,
                participants: true,
                customerInfo: true,
                // Activity classification — read-through so the tour header can
                // render the EXACT same activity badge as the Deal header
                // (resolveActivityLabel: activityType + effective org-type + subtype).
                activityType: true,
                organizationType: { select: { label: true } },
                organizationSubtype: { select: { label: true } },
                organization: {
                  select: { id: true, name: true, organizationType: { select: { label: true } } },
                },
                organizationUnit: { select: { id: true, name: true } },
                contacts: {
                  orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
                  select: {
                    roles: true,
                    isPrimary: true,
                    contact: {
                      select: {
                        id: true,
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
    const occ = await occupancyFor(prisma, [tour.id]);
    res.json({
      ...toClientTour(tour, occ[tour.id]),
      // Same canonical derivation as the list/calendar — clients never
      // compute their own guide-color rule.
      guideColor: resolveTourGuideColor(toColorAssignments(tour.assignments)),
    });
  }),
);

// ---------- activity components (per tour) ----------
// The tour's DELIVERED components (seeded from the product at creation; owned by
// the tour after). Add / remove / reorder, and set a WorkshopLocation per
// workshop component (a tour may hold several workshop components, each in a
// different place). Non-workshop components never carry a location.

const TOUR_COMPONENT_INCLUDE = { activityComponent: true, workshopLocation: true };

// Add a component to a tour. Body { activityComponentId, workshopLocationId? }.
router.post(
  '/:id/components',
  handle(async (req, res) => {
    const b = req.body || {};
    const tour = await prisma.tourEvent.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!tour) return res.status(404).json({ error: 'not_found' });
    const component = await prisma.activityComponent.findUnique({
      where: { id: String(b.activityComponentId || '') },
      select: { id: true, isActive: true, isWorkshop: true },
    });
    if (!component) return res.status(400).json({ error: 'component_not_found' });
    // A NEW assignment must use an active catalog entry (existing rows survive a
    // later deactivation — see the delete guard on the catalog).
    if (!component.isActive) return res.status(409).json({ error: 'component_inactive' });

    const loc = validateWorkshopLocationForComponent(component.isWorkshop, b.workshopLocationId);
    if (!loc.ok) return res.status(400).json({ error: loc.error });

    const last = await prisma.tourEventActivityComponent.findFirst({
      where: { tourEventId: tour.id },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    try {
      const row = await prisma.tourEventActivityComponent.create({
        data: {
          tourEventId: tour.id,
          activityComponentId: component.id,
          workshopLocationId: loc.workshopLocationId,
          sortOrder: (last?.sortOrder ?? -1) + 1,
        },
        include: TOUR_COMPONENT_INCLUDE,
      });
      // Only a workshop WITH a location changes the calendar's location line.
      if (row.workshopLocationId) await markTourCalendarPending(prisma, tour.id);
      res.status(201).json(row);
    } catch (e) {
      if (e.code === 'P2002') return res.status(409).json({ error: 'component_already_on_tour' });
      throw e;
    }
  }),
);

// Reorder — before '/components/:rowId'.
router.put(
  '/:id/components/reorder',
  handle(async (req, res) => {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.filter((x) => typeof x === 'string')
      : [];
    if (!ids.length) return res.json({ ok: true });
    // Scope the reorder to THIS tour's rows so a stray id can't touch another.
    const rows = await prisma.tourEventActivityComponent.findMany({
      where: { tourEventId: req.params.id },
      select: { id: true },
    });
    const own = new Set(rows.map((r) => r.id));
    await prisma.$transaction(
      ids
        .filter((id) => own.has(id))
        .map((id, i) =>
          prisma.tourEventActivityComponent.update({ where: { id }, data: { sortOrder: i } }),
        ),
    );
    // Component order drives the order of workshop locations in the calendar
    // event's location line (harmless no-op reconcile otherwise).
    await markTourCalendarPending(prisma, req.params.id);
    res.json({ ok: true });
  }),
);

// Set/clear a workshop component's location. Body { workshopLocationId | null }.
router.put(
  '/components/:rowId',
  handle(async (req, res) => {
    const row = await prisma.tourEventActivityComponent.findUnique({
      where: { id: req.params.rowId },
      include: { activityComponent: { select: { isWorkshop: true } } },
    });
    if (!row) return res.status(404).json({ error: 'not_found' });
    const loc = validateWorkshopLocationForComponent(
      row.activityComponent.isWorkshop,
      req.body?.workshopLocationId,
    );
    if (!loc.ok) return res.status(400).json({ error: loc.error });
    const updated = await prisma.tourEventActivityComponent.update({
      where: { id: row.id },
      data: { workshopLocationId: loc.workshopLocationId },
      include: TOUR_COMPONENT_INCLUDE,
    });
    if ((row.workshopLocationId || null) !== (loc.workshopLocationId || null)) {
      await markTourCalendarPending(prisma, row.tourEventId);
    }
    res.json(updated);
  }),
);

router.delete(
  '/components/:rowId',
  handle(async (req, res) => {
    const row = await prisma.tourEventActivityComponent.findUnique({
      where: { id: req.params.rowId },
      select: { id: true, tourEventId: true, workshopLocationId: true },
    });
    if (!row) return res.status(404).json({ error: 'not_found' });
    await prisma.tourEventActivityComponent.delete({ where: { id: row.id } });
    if (row.workshopLocationId) await markTourCalendarPending(prisma, row.tourEventId);
    res.status(204).end();
  }),
);

// Reseed a tour's components from its CURRENT variant's defaults — the explicit
// "replace" path when the operator changes the product/variant (spec §5). The
// selected VARIANT is authoritative for defaults. Replaces the whole set;
// workshop-location choices are intentionally reset (new components).
router.post(
  '/:id/components/reseed',
  handle(async (req, res) => {
    const tour = await prisma.tourEvent.findUnique({
      where: { id: req.params.id },
      select: { id: true, productVariantId: true },
    });
    if (!tour) return res.status(404).json({ error: 'not_found' });
    await prisma.$transaction(async (tx) => {
      await tx.tourEventActivityComponent.deleteMany({ where: { tourEventId: tour.id } });
      await seedTourComponents(tx, tour.id, tour.productVariantId);
      // Reseed resets workshop-location choices → calendar location changes.
      await markTourCalendarPending(tx, tour.id);
    });
    const rows = await prisma.tourEventActivityComponent.findMany({
      where: { tourEventId: tour.id },
      orderBy: { sortOrder: 'asc' },
      include: TOUR_COMPONENT_INCLUDE,
    });
    res.json(rows);
  }),
);

// ---------- guide assignments ----------
// Role lives on the assignment (lead_guide | guide | workshop_assistant);
// switching a role UPDATES the row — one assignment per person per tour.

const ASSIGNMENT_ROLES = ['lead_guide', 'guide', 'workshop_assistant'];

router.post(
  '/:id/assignments',
  handle(async (req, res) => {
    const b = req.body || {};
    if (!ASSIGNMENT_ROLES.includes(b.role)) {
      return res.status(400).json({ error: 'invalid_role' });
    }
    const tour = await prisma.tourEvent.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!tour) return res.status(404).json({ error: 'not_found' });
    const person = await prisma.personRef.findUnique({
      where: { id: String(b.personRefId || '') },
      select: {
        id: true,
        externalPersonId: true,
        displayName: true,
        status: true,
        lifecycleHint: true,
      },
    });
    if (!person) return res.status(400).json({ error: 'person_not_found' });
    // Canonical eligibility gate (people/eligibility.js): only active
    // guides/trainees may receive NEW assignments — a crafted request with a
    // departed/blocked person's id is rejected here regardless of the UI.
    if (!isAssignableStaff(person)) {
      return res.status(422).json({ error: 'person_not_assignable' });
    }

    let assignment;
    try {
      assignment = await prisma.tourAssignment.create({
        data: {
          tourEventId: tour.id,
          personRefId: person.id,
          externalPersonId: person.externalPersonId,
          displayName: person.displayName,
          role: b.role,
          notes: b.notes ? String(b.notes) : null,
        },
      });
    } catch (e) {
      if (e.code === 'P2002') return res.status(409).json({ error: 'already_assigned' });
      throw e;
    }
    await emitTimelineEvent(prisma, {
      subjectType: 'tour_event',
      subjectId: tour.id,
      kind: 'tour',
      data: { event: 'guide_assigned', name: person.displayName, role: b.role },
      origin: await userOrigin(req.adminAuth?.userId),
    });
    // New attendee — Google will invite ONLY the added guide. Role changes
    // (PUT below) deliberately do NOT mark: roles never affect the calendar.
    await markTourCalendarPending(prisma, tour.id);
    res.status(201).json(assignment);
  }),
);

router.put(
  '/assignments/:assignmentId',
  handle(async (req, res) => {
    const b = req.body || {};
    const existing = await prisma.tourAssignment.findUnique({
      where: { id: req.params.assignmentId },
    });
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const data = {};
    if (b.role !== undefined) {
      if (!ASSIGNMENT_ROLES.includes(b.role)) return res.status(400).json({ error: 'invalid_role' });
      data.role = b.role;
    }
    if (b.notes !== undefined) data.notes = b.notes ? String(b.notes) : null;
    const updated = await prisma.tourAssignment.update({
      where: { id: existing.id },
      data,
    });
    if (data.role && data.role !== existing.role) {
      await emitTimelineEvent(prisma, {
        subjectType: 'tour_event',
        subjectId: existing.tourEventId,
        kind: 'tour',
        data: { event: 'guide_role_changed', name: existing.displayName, from: existing.role, to: data.role },
        origin: await userOrigin(req.adminAuth?.userId),
      });
    }
    res.json(updated);
  }),
);

router.delete(
  '/assignments/:assignmentId',
  handle(async (req, res) => {
    const existing = await prisma.tourAssignment.findUnique({
      where: { id: req.params.assignmentId },
    });
    if (!existing) return res.status(404).json({ error: 'not_found' });
    await prisma.tourAssignment.delete({ where: { id: existing.id } });
    await emitTimelineEvent(prisma, {
      subjectType: 'tour_event',
      subjectId: existing.tourEventId,
      kind: 'tour',
      data: { event: 'guide_removed', name: existing.displayName, role: existing.role },
      origin: await userOrigin(req.adminAuth?.userId),
    });
    // Removed attendee — Google sends the cancellation ONLY to that guide.
    await markTourCalendarPending(prisma, existing.tourEventId);
    res.status(204).end();
  }),
);

// ---------- create (group slots only) ----------
// private/business TourEvents are ONLY created by the deal WON transition —
// manual creation would bypass the no-draft gate and duplicate that logic.

router.post(
  '/',
  handle(async (req, res) => {
    const b = req.body || {};
    if (b.kind !== undefined && b.kind !== 'group_slot') {
      return res.status(400).json({ error: 'only_group_slots_created_here' });
    }

    const missing = missingFields(b, GROUP_SLOT_REQUIRED_FIELDS);
    if (missing.length) {
      return res.status(422).json({ error: 'missing_required_fields', missing });
    }

    const data = { kind: 'group_slot' };
    const fieldErr = applySlotFields(b, data);
    if (fieldErr) return res.status(400).json({ error: fieldErr });

    const variant = await resolveVariant(b.productId, b.productVariantId);
    if (!variant) return res.status(400).json({ error: 'invalid_product_variant' });
    data.productId = b.productId;
    data.productVariantId = variant.id;
    data.locationId = variant.locationId;
    // New slot → Google Calendar event (the sync worker creates it async).
    Object.assign(data, calendarPendingPatch());

    const tour = await prisma.tourEvent.create({ data, include: TOUR_INCLUDE });
    kickTourCalendarSync();
    await emitTimelineEvent(prisma, {
      subjectType: 'tour_event',
      subjectId: tour.id,
      kind: 'tour',
      data: { event: 'slot_created', date: tour.date, startTime: tour.startTime },
      origin: await userOrigin(req.adminAuth?.userId),
    });
    res.status(201).json(toClientTour(tour, null));
  }),
);

// ---------- update ----------

router.put(
  '/:id',
  handle(async (req, res) => {
    const b = req.body || {};
    const existing = await prisma.tourEvent.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        kind: true,
        status: true,
        productId: true,
        productVariantId: true,
        date: true,
        startTime: true,
        tourLanguage: true,
        capacity: true,
      },
    });
    if (!existing) return res.status(404).json({ error: 'not_found' });

    const occ = await occupancyFor(prisma, [existing.id]);
    const { activeBookings } = occ[existing.id];

    const data = {};

    // Planning fields — allowed only on group slots (private/business tours
    // mirror their deal; the deal is the planning source of truth).
    const touchesPlanning =
      b.date !== undefined ||
      b.startTime !== undefined ||
      b.tourLanguage !== undefined ||
      b.capacity !== undefined ||
      b.productId !== undefined ||
      b.productVariantId !== undefined;
    if (touchesPlanning && existing.kind !== 'group_slot') {
      return res.status(409).json({ error: 'deal_owns_planning_fields' });
    }

    const fieldErr = applySlotFields(b, data);
    if (fieldErr) return res.status(400).json({ error: fieldErr });

    // Product change (supported by product decision) — always as a validated
    // product+variant pair; the slot city follows the variant.
    if (b.productId !== undefined || b.productVariantId !== undefined) {
      const productId = b.productId ?? existing.productId;
      const productVariantId = b.productVariantId ?? existing.productVariantId;
      const variant = await resolveVariant(productId, productVariantId);
      if (!variant) return res.status(400).json({ error: 'invalid_product_variant' });
      data.productId = productId;
      data.productVariantId = variant.id;
      data.locationId = variant.locationId;
    }

    // A group slot must never lose a required field (no draft states).
    if (existing.kind === 'group_slot') {
      const missing = missingFields({ ...existing, ...data }, GROUP_SLOT_REQUIRED_FIELDS);
      if (missing.length) {
        return res.status(422).json({ error: 'missing_required_fields', missing });
      }
    }

    // Status transitions. Cancelling a tour that still has ACTIVE bookings is
    // refused — participating deals must be moved/removed first ("החלף סיור").
    if (b.status !== undefined && b.status !== existing.status) {
      if (!TOUR_EVENT_STATUSES.includes(b.status)) {
        return res.status(400).json({ error: 'invalid_status' });
      }
      // 'postponed' is entered/exited ONLY by the Deal's Apply Tour Update
      // orchestration (which also clears/sets the date) — never by manual
      // PATCH, so a scheduled tour can't silently lose its date here and a
      // postponed (dateless) tour can't be flipped scheduled without one.
      if (b.status === 'postponed' || existing.status === 'postponed') {
        return res.status(409).json({ error: 'postponed_via_deal_only' });
      }
      if (b.status === 'cancelled' && activeBookings > 0) {
        return res.status(409).json({ error: 'tour_has_active_bookings' });
      }
      data.status = b.status;
      data.cancelledAt = b.status === 'cancelled' ? new Date() : null;
    }

    // Calendar-visible change (date/time/variant/language/status) → mark the
    // mirror dirty; the sync worker converges the Google event asynchronously.
    if (patchTouchesCalendar(data)) Object.assign(data, calendarPendingPatch());

    const tour = await prisma.tourEvent.update({
      where: { id: existing.id },
      data,
      include: TOUR_INCLUDE,
    });
    if (data.gcalSyncStatus === 'pending') kickTourCalendarSync();
    if (data.status && data.status !== existing.status) {
      const origin = await userOrigin(req.adminAuth?.userId);
      await emitTimelineEvent(prisma, {
        subjectType: 'tour_event',
        subjectId: tour.id,
        kind: 'tour',
        data: { event: 'status_changed', from: existing.status, to: data.status },
        origin,
      });
      // Manual cancel joins the SAME gallery cleanup path as auto-cancel:
      // links revoked now, R2 purged async after the grace window.
      if (data.status === 'cancelled') {
        await scheduleGalleryCleanup(prisma, tour.id, { reason: 'tour_cancelled', origin });
      }
    }
    const occAfter = await occupancyFor(prisma, [tour.id]);
    res.json(toClientTour(tour, occAfter[tour.id]));
  }),
);

// ---------- delete ----------
// Product rule: only EMPTY tours (no booking rows at all — active or
// historical) may be deleted. The DB Restrict FK backs this check.

router.delete(
  '/:id',
  handle(async (req, res) => {
    const existing = await prisma.tourEvent.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        gcalEventId: true,
        gcalAccountId: true,
        _count: { select: { bookings: true } },
      },
    });
    if (!existing) return res.status(404).json({ error: 'not_found' });
    if (existing._count.bookings > 0) {
      return res.status(409).json({ error: 'tour_has_bookings' });
    }
    // BEFORE the delete (cascade wipes the gallery rows): schedule the R2
    // purge — the task row has no FK and survives with the stored prefix.
    await scheduleGalleryCleanup(prisma, existing.id, {
      reason: 'tour_deleted',
      origin: await userOrigin(req.adminAuth?.userId),
    });
    // Same pattern for the Google event: the row is about to disappear, so its
    // event identity moves to a tombstone the calendar worker cancels async.
    await scheduleCalendarTombstone(prisma, existing);
    await prisma.tourEvent.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

export default router;
