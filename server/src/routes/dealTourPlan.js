import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { isAssignableStaff } from '../people/eligibility.js';
import { validateWorkshopLocationForComponent } from '../tours/activityCatalog.js';
import { activeBookingFor } from '../tours/tourFromDeal.js';

// Deal Tour PLANNING (pre-WON) — mounted at /api/deals, serves /:dealId/tour-plan*.
// The plan is STRICTLY internal: no TourEvent, no Google Calendar, no guide
// invitations, no portal visibility. Route/error shapes deliberately mirror the
// tour assignment/component routes (routes/tours.js) so the SHARED editors
// (TourTeamEditor / TourComponents) drive either surface through an endpoint
// adapter — one UI, two backends, zero duplicated flows.
//
// Component semantics: while plan.componentsCustomized is FALSE the plan
// FOLLOWS the selected variant's live defaults (GET exposes them as
// variantDefaults; materialization seeds from the variant — today's behavior).
// The first component mutation (reseed/add) flips the flag and the plan's own
// rows become authoritative, including an intentionally-empty list.

const router = Router();

const PLAN_ROLES = ['lead_guide', 'guide', 'workshop_assistant'];

const PLAN_INCLUDE = {
  assignments: {
    orderBy: { createdAt: 'asc' },
    include: {
      personRef: {
        select: {
          id: true,
          displayName: true,
          status: true,
          lifecycleHint: true,
          profile: { select: { imageUrl: true } },
        },
      },
    },
  },
  activityComponents: {
    orderBy: { sortOrder: 'asc' },
    include: { activityComponent: true, workshopLocation: true },
  },
};

// Same orderNo→cuid URL support as the deals router (docs on router.param there).
router.param('dealId', (req, _res, next, value) => {
  if (!/^\d+$/.test(value)) return next();
  const orderNo = Number(value);
  if (!Number.isSafeInteger(orderNo) || orderNo > 2147483647) return next();
  prisma.deal
    .findUnique({ where: { orderNo }, select: { id: true } })
    .then((found) => {
      if (found) req.params.dealId = found.id;
      next();
    })
    .catch(next);
});

function dealSelect() {
  return { id: true, activityType: true, status: true, productVariantId: true };
}

// Planning exists for private/business deals only (a group deal joins a slot —
// the slot owns its own team/components), and is frozen once a REAL tour is
// live (the tour is edited directly then). Returns null when mutation may
// proceed, otherwise responds and returns the response.
async function planMutationGuard(res, deal) {
  if (!deal) return res.status(404).json({ error: 'not_found' });
  if (deal.activityType !== 'private' && deal.activityType !== 'business') {
    return res.status(409).json({ error: 'plan_not_applicable' });
  }
  if (deal.status === 'won') {
    const booking = await activeBookingFor(prisma, deal.id);
    if (booking) return res.status(409).json({ error: 'tour_exists' });
  }
  return null;
}

async function ensurePlan(client, dealId) {
  return client.dealTourPlan.upsert({
    where: { dealId },
    create: { dealId },
    update: {},
  });
}

async function loadPlan(dealId) {
  return prisma.dealTourPlan.findUnique({ where: { dealId }, include: PLAN_INCLUDE });
}

// The variant's live default components (ordered) — what materialization will
// seed while the plan is not customized. Read-through; nothing stored.
async function variantDefaults(productVariantId) {
  if (!productVariantId) return [];
  return prisma.productVariantActivityComponent.findMany({
    where: { productVariantId },
    orderBy: { sortOrder: 'asc' },
    include: { activityComponent: true },
  });
}

// ---------- read ----------

router.get(
  '/:dealId/tour-plan',
  handle(async (req, res) => {
    const deal = await prisma.deal.findUnique({
      where: { id: req.params.dealId },
      select: dealSelect(),
    });
    if (!deal) return res.status(404).json({ error: 'not_found' });
    const applicable = deal.activityType === 'private' || deal.activityType === 'business';
    const booking = applicable ? await activeBookingFor(prisma, deal.id) : null;
    res.json({
      plan: applicable ? await loadPlan(deal.id) : null,
      variantDefaults: applicable ? await variantDefaults(deal.productVariantId) : [],
      applicable,
      editable: applicable && !booking,
    });
  }),
);

// ---------- plan scalars (notes) ----------

router.put(
  '/:dealId/tour-plan',
  handle(async (req, res) => {
    const deal = await prisma.deal.findUnique({
      where: { id: req.params.dealId },
      select: dealSelect(),
    });
    const blocked = await planMutationGuard(res, deal);
    if (blocked) return;
    const b = req.body || {};
    const plan = await ensurePlan(prisma, deal.id);
    const data = {};
    if (b.notes !== undefined) data.notes = b.notes ? String(b.notes) : null;
    if (Object.keys(data).length) {
      await prisma.dealTourPlan.update({ where: { id: plan.id }, data });
    }
    res.json(await loadPlan(deal.id));
  }),
);

// ---------- planned team ----------
// NOT TourAssignments: planned guides receive nothing and see nothing. The
// canonical eligibility rule (people/eligibility.js) gates creation exactly
// like real assignments — same error keys so the shared editor needs no branch.

router.post(
  '/:dealId/tour-plan/assignments',
  handle(async (req, res) => {
    const b = req.body || {};
    if (!PLAN_ROLES.includes(b.role)) {
      return res.status(400).json({ error: 'invalid_role' });
    }
    const deal = await prisma.deal.findUnique({
      where: { id: req.params.dealId },
      select: dealSelect(),
    });
    const blocked = await planMutationGuard(res, deal);
    if (blocked) return;
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
    if (!isAssignableStaff(person)) {
      return res.status(422).json({ error: 'person_not_assignable' });
    }
    const plan = await ensurePlan(prisma, deal.id);
    try {
      const assignment = await prisma.dealTourPlanAssignment.create({
        data: {
          planId: plan.id,
          personRefId: person.id,
          externalPersonId: person.externalPersonId,
          displayName: person.displayName,
          role: b.role,
          notes: b.notes ? String(b.notes) : null,
        },
      });
      res.status(201).json(assignment);
    } catch (e) {
      if (e.code === 'P2002') return res.status(409).json({ error: 'already_assigned' });
      throw e;
    }
  }),
);

router.put(
  '/tour-plan/assignments/:assignmentId',
  handle(async (req, res) => {
    const b = req.body || {};
    const existing = await prisma.dealTourPlanAssignment.findUnique({
      where: { id: req.params.assignmentId },
      include: { plan: { select: { dealId: true } } },
    });
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const deal = await prisma.deal.findUnique({
      where: { id: existing.plan.dealId },
      select: dealSelect(),
    });
    const blocked = await planMutationGuard(res, deal);
    if (blocked) return;
    const data = {};
    if (b.role !== undefined) {
      if (!PLAN_ROLES.includes(b.role)) return res.status(400).json({ error: 'invalid_role' });
      data.role = b.role;
    }
    if (b.notes !== undefined) data.notes = b.notes ? String(b.notes) : null;
    res.json(
      await prisma.dealTourPlanAssignment.update({ where: { id: existing.id }, data }),
    );
  }),
);

router.delete(
  '/tour-plan/assignments/:assignmentId',
  handle(async (req, res) => {
    const existing = await prisma.dealTourPlanAssignment.findUnique({
      where: { id: req.params.assignmentId },
      include: { plan: { select: { dealId: true } } },
    });
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const deal = await prisma.deal.findUnique({
      where: { id: existing.plan.dealId },
      select: dealSelect(),
    });
    const blocked = await planMutationGuard(res, deal);
    if (blocked) return;
    await prisma.dealTourPlanAssignment.delete({ where: { id: existing.id } });
    res.status(204).end();
  }),
);

// ---------- planned components ----------

const PLAN_COMPONENT_INCLUDE = { activityComponent: true, workshopLocation: true };

router.post(
  '/:dealId/tour-plan/components',
  handle(async (req, res) => {
    const b = req.body || {};
    const deal = await prisma.deal.findUnique({
      where: { id: req.params.dealId },
      select: dealSelect(),
    });
    const blocked = await planMutationGuard(res, deal);
    if (blocked) return;
    const component = await prisma.activityComponent.findUnique({
      where: { id: String(b.activityComponentId || '') },
      select: { id: true, isActive: true, isWorkshop: true },
    });
    if (!component) return res.status(400).json({ error: 'component_not_found' });
    if (!component.isActive) return res.status(409).json({ error: 'component_inactive' });
    const loc = validateWorkshopLocationForComponent(component.isWorkshop, b.workshopLocationId);
    if (!loc.ok) return res.status(400).json({ error: loc.error });

    const plan = await ensurePlan(prisma, deal.id);
    const last = await prisma.dealTourPlanActivityComponent.findFirst({
      where: { planId: plan.id },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    try {
      const row = await prisma.dealTourPlanActivityComponent.create({
        data: {
          planId: plan.id,
          activityComponentId: component.id,
          workshopLocationId: loc.workshopLocationId,
          sortOrder: (last?.sortOrder ?? -1) + 1,
        },
        include: PLAN_COMPONENT_INCLUDE,
      });
      // The plan's own rows are authoritative from the first edit.
      await prisma.dealTourPlan.update({
        where: { id: plan.id },
        data: { componentsCustomized: true },
      });
      res.status(201).json(row);
    } catch (e) {
      if (e.code === 'P2002') return res.status(409).json({ error: 'component_already_on_tour' });
      throw e;
    }
  }),
);

router.put(
  '/:dealId/tour-plan/components/reorder',
  handle(async (req, res) => {
    const deal = await prisma.deal.findUnique({
      where: { id: req.params.dealId },
      select: dealSelect(),
    });
    const blocked = await planMutationGuard(res, deal);
    if (blocked) return;
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.filter((x) => typeof x === 'string')
      : [];
    if (!ids.length) return res.json({ ok: true });
    const plan = await prisma.dealTourPlan.findUnique({ where: { dealId: deal.id } });
    if (!plan) return res.json({ ok: true });
    const rows = await prisma.dealTourPlanActivityComponent.findMany({
      where: { planId: plan.id },
      select: { id: true },
    });
    const own = new Set(rows.map((r) => r.id));
    await prisma.$transaction(
      ids
        .filter((id) => own.has(id))
        .map((id, i) =>
          prisma.dealTourPlanActivityComponent.update({ where: { id }, data: { sortOrder: i } }),
        ),
    );
    res.json({ ok: true });
  }),
);

router.put(
  '/tour-plan/components/:rowId',
  handle(async (req, res) => {
    const row = await prisma.dealTourPlanActivityComponent.findUnique({
      where: { id: req.params.rowId },
      include: {
        activityComponent: { select: { isWorkshop: true } },
        plan: { select: { dealId: true } },
      },
    });
    if (!row) return res.status(404).json({ error: 'not_found' });
    const deal = await prisma.deal.findUnique({
      where: { id: row.plan.dealId },
      select: dealSelect(),
    });
    const blocked = await planMutationGuard(res, deal);
    if (blocked) return;
    const loc = validateWorkshopLocationForComponent(
      row.activityComponent.isWorkshop,
      req.body?.workshopLocationId,
    );
    if (!loc.ok) return res.status(400).json({ error: loc.error });
    res.json(
      await prisma.dealTourPlanActivityComponent.update({
        where: { id: row.id },
        data: { workshopLocationId: loc.workshopLocationId },
        include: PLAN_COMPONENT_INCLUDE,
      }),
    );
  }),
);

router.delete(
  '/tour-plan/components/:rowId',
  handle(async (req, res) => {
    const row = await prisma.dealTourPlanActivityComponent.findUnique({
      where: { id: req.params.rowId },
      include: { plan: { select: { dealId: true } } },
    });
    if (!row) return res.status(404).json({ error: 'not_found' });
    const deal = await prisma.deal.findUnique({
      where: { id: row.plan.dealId },
      select: dealSelect(),
    });
    const blocked = await planMutationGuard(res, deal);
    if (blocked) return;
    await prisma.dealTourPlanActivityComponent.delete({ where: { id: row.id } });
    res.status(204).end();
  }),
);

// Copy the CURRENT variant defaults into the plan (the explicit "customize"
// entry point, and the "replace with defaults" action after a variant change).
// Mirrors POST /api/tours/:id/components/reseed.
router.post(
  '/:dealId/tour-plan/components/reseed',
  handle(async (req, res) => {
    const deal = await prisma.deal.findUnique({
      where: { id: req.params.dealId },
      select: dealSelect(),
    });
    const blocked = await planMutationGuard(res, deal);
    if (blocked) return;
    const plan = await ensurePlan(prisma, deal.id);
    const defaults = await variantDefaults(deal.productVariantId);
    await prisma.$transaction(async (tx) => {
      await tx.dealTourPlanActivityComponent.deleteMany({ where: { planId: plan.id } });
      if (defaults.length) {
        await tx.dealTourPlanActivityComponent.createMany({
          data: defaults.map((d, i) => ({
            planId: plan.id,
            activityComponentId: d.activityComponentId,
            sortOrder: i,
            workshopLocationId: null,
          })),
        });
      }
      await tx.dealTourPlan.update({
        where: { id: plan.id },
        data: { componentsCustomized: true },
      });
    });
    res.json(
      await prisma.dealTourPlanActivityComponent.findMany({
        where: { planId: plan.id },
        orderBy: { sortOrder: 'asc' },
        include: PLAN_COMPONENT_INCLUDE,
      }),
    );
  }),
);

// Back to "follow the variant defaults": drop the plan's own rows and clear the
// customized flag — materialization seeds from the variant again.
router.delete(
  '/:dealId/tour-plan/components',
  handle(async (req, res) => {
    const deal = await prisma.deal.findUnique({
      where: { id: req.params.dealId },
      select: dealSelect(),
    });
    const blocked = await planMutationGuard(res, deal);
    if (blocked) return;
    const plan = await prisma.dealTourPlan.findUnique({ where: { dealId: deal.id } });
    if (plan) {
      await prisma.$transaction([
        prisma.dealTourPlanActivityComponent.deleteMany({ where: { planId: plan.id } }),
        prisma.dealTourPlan.update({
          where: { id: plan.id },
          data: { componentsCustomized: false },
        }),
      ]);
    }
    res.status(204).end();
  }),
);

export default router;
