import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import {
  GROUP_SLOT_REQUIRED_FIELDS,
  TOUR_EVENT_STATUSES,
  TOUR_LANGS,
  DATE_RE,
  TIME_RE,
  missingFields,
} from '../tours/requiredFields.js';
import { occupancyFor } from '../tours/occupancy.js';
import { emitTimelineEvent, userOrigin } from '../timeline/events.js';

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
    const occ = await occupancyFor(prisma, tours.map((t) => t.id));
    res.json(tours.map((t) => toClientTour(t, occ[t.id])));
  }),
);

router.get(
  '/:id',
  handle(async (req, res) => {
    const tour = await prisma.tourEvent.findUnique({
      where: { id: req.params.id },
      include: {
        ...TOUR_INCLUDE,
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
                organization: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });
    if (!tour) return res.status(404).json({ error: 'not_found' });
    const occ = await occupancyFor(prisma, [tour.id]);
    res.json(toClientTour(tour, occ[tour.id]));
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

    const tour = await prisma.tourEvent.create({ data, include: TOUR_INCLUDE });
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
      if (b.status === 'cancelled' && activeBookings > 0) {
        return res.status(409).json({ error: 'tour_has_active_bookings' });
      }
      data.status = b.status;
      data.cancelledAt = b.status === 'cancelled' ? new Date() : null;
    }

    const tour = await prisma.tourEvent.update({
      where: { id: existing.id },
      data,
      include: TOUR_INCLUDE,
    });
    if (data.status && data.status !== existing.status) {
      await emitTimelineEvent(prisma, {
        subjectType: 'tour_event',
        subjectId: tour.id,
        kind: 'tour',
        data: { event: 'status_changed', from: existing.status, to: data.status },
        origin: await userOrigin(req.adminAuth?.userId),
      });
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
      select: { id: true, _count: { select: { bookings: true } } },
    });
    if (!existing) return res.status(404).json({ error: 'not_found' });
    if (existing._count.bookings > 0) {
      return res.status(409).json({ error: 'tour_has_bookings' });
    }
    await prisma.tourEvent.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

export default router;
