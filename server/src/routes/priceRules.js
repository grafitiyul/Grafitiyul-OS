import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

// Price Rules (Slice 2). Each rule belongs to a PriceList. Scopes (product,
// variant, activityType, organizationSubtype) are optional — null = wildcard.
// priceModel (per_head | tiered) selects which price fields apply. Admin-only.

const router = Router();

const PRICE_MODELS = ['per_head', 'tiered'];
const VAT_MODES = ['included', 'excluded'];

// Minor-unit → BigInt | null. Accepts numbers/strings; '' and null → null.
function toBig(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return BigInt(Math.round(n));
}
function toInt(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

// Build the writable data payload shared by create/update. `partial` controls
// whether absent keys are skipped (update) or defaulted (create).
function buildData(body, { partial }) {
  const data = {};
  const set = (key, val) => {
    if (partial && body[key] === undefined) return;
    data[key] = val;
  };
  // Scopes — empty/absent means wildcard (null).
  set('productId', body.productId || null);
  set('productVariantId', body.productVariantId || null);
  set('activityTypeId', body.activityTypeId || null);
  set('organizationSubtypeId', body.organizationSubtypeId || null);
  // Price model fields.
  if (!partial || body.priceModel !== undefined)
    data.priceModel = PRICE_MODELS.includes(body.priceModel)
      ? body.priceModel
      : 'per_head';
  set('adultPriceMinor', toBig(body.adultPriceMinor));
  set('childPriceMinor', toBig(body.childPriceMinor));
  set('basePriceMinor', toBig(body.basePriceMinor));
  set('baseParticipants', toInt(body.baseParticipants));
  set('perAdditionalParticipantMinor', toBig(body.perAdditionalParticipantMinor));
  // VAT override — null inherits the price list defaults.
  set('vatMode', VAT_MODES.includes(body.vatMode) ? body.vatMode : null);
  set('vatRate', toInt(body.vatRate));
  set('priority', toInt(body.priority) ?? 0);
  if (!partial || body.active !== undefined) data.active = body.active !== false;
  return data;
}

router.get(
  '/',
  handle(async (req, res) => {
    const where = {};
    if (req.query.priceListId)
      where.priceListId = String(req.query.priceListId);
    const rules = await prisma.priceRule.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
    res.json(rules);
  }),
);

router.post(
  '/',
  handle(async (req, res) => {
    const priceListId = String(req.body?.priceListId || '');
    if (!priceListId)
      return res.status(400).json({ error: 'priceListId_required' });
    const list = await prisma.priceList.findUnique({
      where: { id: priceListId },
    });
    if (!list) return res.status(404).json({ error: 'price_list_not_found' });
    const rule = await prisma.priceRule.create({
      data: { priceListId, ...buildData(req.body || {}, { partial: false }) },
    });
    res.status(201).json(rule);
  }),
);

router.put(
  '/:id',
  handle(async (req, res) => {
    const rule = await prisma.priceRule.update({
      where: { id: req.params.id },
      data: buildData(req.body || {}, { partial: true }),
    });
    res.json(rule);
  }),
);

router.delete(
  '/:id',
  handle(async (req, res) => {
    await prisma.priceRule.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

export default router;
