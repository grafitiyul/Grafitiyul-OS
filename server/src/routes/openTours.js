import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { ensureTourSlots } from '../tours/openTourGeneration.js';
import { buildGroupCards } from '../pricing/groupTicketCards.js';
import {
  buildTemplatePatch,
  buildRulePatch,
  buildExceptionPatch,
  normalizeTemplateProducts,
} from '../tours/openTourValidation.js';

// Open Tours admin API (/api/open-tours) — CRUD for recurring tour TEMPLATES
// (the "what"), their offered sellable products, weekly SCHEDULE RULES (the
// "when"), and one-off EXCEPTIONS. Nothing here encodes a product name/id:
// offered products are Pricing Cards flagged availableForGroupTickets, chosen by
// the owner. After any change that affects generation we materialize slots
// immediately (sync-on-write), mirroring the tours router's sync-on-read.

const router = Router();

const TEMPLATE_INCLUDE = {
  location: { select: { id: true, nameHe: true } },
  products: {
    orderBy: { sortOrder: 'asc' },
    include: {
      productVariant: {
        select: {
          id: true,
          durationHours: true,
          product: { select: { id: true, nameHe: true } },
          location: { select: { id: true, nameHe: true } },
        },
      },
    },
  },
  scheduleRules: { orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }] },
  exceptions: { orderBy: { date: 'asc' } },
};

async function regenerate() {
  try {
    await ensureTourSlots(prisma);
  } catch (e) {
    console.error('[open-tours] slot generation failed', e);
  }
}

// ── Sellable products picker (Pricing Cards flagged for group tickets) ───────
router.get(
  '/sellable-products',
  handle(async (_req, res) => {
    const rules = await prisma.priceRule.findMany({
      where: { availableForGroupTickets: true, active: true },
      orderBy: [{ cardSortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        product: { select: { nameHe: true } },
        ticketPrices: { include: { ticketType: { select: { nameHe: true, sortOrder: true } } } },
      },
    });
    // Attach the representative rule id per card so the UI can persist a loose
    // pricing ref alongside cardGroupId + productVariantId.
    const repByGroup = new Map();
    for (const r of rules) if (r.cardGroupId && !repByGroup.has(r.cardGroupId)) repByGroup.set(r.cardGroupId, r.id);
    const { cards, unconfigured } = buildGroupCards(rules);
    res.json({
      cards: cards.map((c) => ({ ...c, priceRuleId: repByGroup.get(c.cardGroupId) || null })),
      unconfigured,
    });
  }),
);

// ── Templates ────────────────────────────────────────────────────────────────
router.get(
  '/',
  handle(async (_req, res) => {
    const templates = await prisma.openTourTemplate.findMany({
      orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
      include: TEMPLATE_INCLUDE,
    });
    res.json(templates);
  }),
);

router.get(
  '/:id',
  handle(async (req, res) => {
    const template = await prisma.openTourTemplate.findUnique({
      where: { id: req.params.id },
      include: TEMPLATE_INCLUDE,
    });
    if (!template) return res.status(404).json({ error: 'not_found' });
    res.json(template);
  }),
);

router.post(
  '/',
  handle(async (req, res) => {
    const { data, error } = buildTemplatePatch(req.body, { partial: false });
    if (error) return res.status(400).json({ error });
    // Optional nested products on create.
    let productRows = [];
    if (req.body?.products !== undefined) {
      const norm = normalizeTemplateProducts(req.body.products);
      if (norm.error) return res.status(400).json({ error: norm.error });
      productRows = norm.rows;
    }
    const template = await prisma.openTourTemplate.create({
      data: { ...data, products: productRows.length ? { create: productRows } : undefined },
      include: TEMPLATE_INCLUDE,
    });
    res.status(201).json(template);
  }),
);

router.put(
  '/:id',
  handle(async (req, res) => {
    const existing = await prisma.openTourTemplate.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const { data, error } = buildTemplatePatch(req.body, { partial: true });
    if (error) return res.status(400).json({ error });
    const template = await prisma.openTourTemplate.update({
      where: { id: existing.id },
      data,
      include: TEMPLATE_INCLUDE,
    });
    await regenerate(); // capacity/language/etc. affect FUTURE slots only
    res.json(template);
  }),
);

router.delete(
  '/:id',
  handle(async (req, res) => {
    // Already-generated slots survive (loose openTourTemplateId ref) — deleting
    // a template (cascades its rules/exceptions/products) only stops FUTURE
    // generation, exactly like deleting a schedule rule.
    await prisma.openTourTemplate.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

// ── Offered products (replace-sync) ─────────────────────────────────────────
router.put(
  '/:id/products',
  handle(async (req, res) => {
    const existing = await prisma.openTourTemplate.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const norm = normalizeTemplateProducts(req.body?.products);
    if (norm.error) return res.status(400).json({ error: norm.error });
    await prisma.$transaction([
      prisma.openTourTemplateProduct.deleteMany({ where: { templateId: existing.id } }),
      ...(norm.rows.length
        ? [
            prisma.openTourTemplateProduct.createMany({
              data: norm.rows.map((r) => ({ ...r, templateId: existing.id })),
            }),
          ]
        : []),
    ]);
    await regenerate(); // base product change affects the zero-registration state
    const template = await prisma.openTourTemplate.findUnique({
      where: { id: existing.id },
      include: TEMPLATE_INCLUDE,
    });
    res.json(template);
  }),
);

// ── Schedule rules ───────────────────────────────────────────────────────────
router.post(
  '/:id/rules',
  handle(async (req, res) => {
    const template = await prisma.openTourTemplate.findUnique({ where: { id: req.params.id } });
    if (!template) return res.status(404).json({ error: 'not_found' });
    const { data, error } = buildRulePatch(req.body, { partial: false });
    if (error) return res.status(400).json({ error });
    const rule = await prisma.openTourScheduleRule.create({
      data: { ...data, templateId: template.id },
    });
    await regenerate();
    res.status(201).json(rule);
  }),
);

router.put(
  '/rules/:ruleId',
  handle(async (req, res) => {
    const existing = await prisma.openTourScheduleRule.findUnique({ where: { id: req.params.ruleId } });
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const { data, error } = buildRulePatch(req.body, { partial: true });
    if (error) return res.status(400).json({ error });
    // Recipe changes apply to FUTURE generation only — already-created slots are
    // real TourEvents and stay as they are (edited individually if needed).
    const rule = await prisma.openTourScheduleRule.update({ where: { id: existing.id }, data });
    await regenerate();
    res.json(rule);
  }),
);

router.delete(
  '/rules/:ruleId',
  handle(async (req, res) => {
    await prisma.openTourScheduleRule.delete({ where: { id: req.params.ruleId } });
    res.status(204).end();
  }),
);

// ── Exceptions ───────────────────────────────────────────────────────────────
router.post(
  '/:id/exceptions',
  handle(async (req, res) => {
    const template = await prisma.openTourTemplate.findUnique({ where: { id: req.params.id } });
    if (!template) return res.status(404).json({ error: 'not_found' });
    const { data, error } = buildExceptionPatch(req.body);
    if (error) return res.status(400).json({ error });
    // Upsert on the (templateId, date, type) unique — re-adding the same
    // exception updates its time/note instead of failing.
    const exception = await prisma.openTourScheduleException.upsert({
      where: { templateId_date_type: { templateId: template.id, date: data.date, type: data.type } },
      create: { ...data, templateId: template.id },
      update: { time: data.time, note: data.note },
    });
    await regenerate();
    res.status(201).json(exception);
  }),
);

router.delete(
  '/exceptions/:exceptionId',
  handle(async (req, res) => {
    await prisma.openTourScheduleException.delete({ where: { id: req.params.exceptionId } });
    res.status(204).end();
  }),
);

export default router;
