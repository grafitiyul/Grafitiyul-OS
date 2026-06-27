import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { calculate, baseAmountMinor, splitVat, PricingError } from '../pricing/engine.js';

// Pricing calculator (Slice 2). Admin-only TEST endpoint for the pricing engine.
// It does NOT touch Deals and writes nothing — it resolves a price list + rule
// for a given context and returns the computed net/vat/gross plus a debug
// summary. This is the only consumer of the engine for now.

const router = Router();

// Resolve which price list applies: organization SUBTYPE default overrides the
// organization TYPE default, which falls back to the system default list.
async function resolvePriceListId({ organizationTypeId, organizationSubtypeId }) {
  if (organizationSubtypeId) {
    const sub = await prisma.organizationSubtype.findUnique({
      where: { id: organizationSubtypeId },
      select: { defaultPriceListId: true },
    });
    if (sub?.defaultPriceListId)
      return { id: sub.defaultPriceListId, source: 'organization_subtype' };
  }
  if (organizationTypeId) {
    const type = await prisma.organizationType.findUnique({
      where: { id: organizationTypeId },
      select: { defaultPriceListId: true },
    });
    if (type?.defaultPriceListId)
      return { id: type.defaultPriceListId, source: 'organization_type' };
  }
  const def = await prisma.priceList.findFirst({
    where: { isDefault: true },
    select: { id: true },
  });
  return def ? { id: def.id, source: 'system_default' } : null;
}

router.post(
  '/calculate',
  handle(async (req, res) => {
    const b = req.body || {};
    const context = {
      productId: b.productId || null,
      productVariantId: b.productVariantId || null,
      activityTypeId: b.activityTypeId || null,
      organizationTypeId: b.organizationTypeId || null,
      organizationSubtypeId: b.organizationSubtypeId || null,
    };
    const counts = {
      adultCount: b.adultCount,
      childCount: b.childCount,
      participantCount: b.participantCount,
      groupCount: b.groupCount != null ? b.groupCount : 1,
    };

    if (!context.activityTypeId)
      return res.json({ ok: false, error: 'activity_type_required' });

    const activityType = await prisma.activityType.findUnique({
      where: { id: context.activityTypeId },
    });
    if (!activityType)
      return res.json({ ok: false, error: 'activity_type_not_found' });

    const resolved = await resolvePriceListId(context);
    if (!resolved)
      return res.json({ ok: false, error: 'no_price_list' });

    const priceList = await prisma.priceList.findUnique({
      where: { id: resolved.id },
      include: {
        rules: {
          where: { active: true },
          include: { tiers: { orderBy: { sortOrder: 'asc' } }, ticketPrices: true },
        },
      },
    });
    if (!priceList) return res.json({ ok: false, error: 'no_price_list' });

    try {
      const result = calculate({ priceList, activityType, context, counts });
      result.priceListSource = resolved.source;
      return res.json(result);
    } catch (e) {
      if (e instanceof PricingError) {
        return res.json({
          ok: false,
          error: e.code,
          details: e.details,
          priceList: { id: priceList.id, nameHe: priceList.nameHe },
          priceListSource: resolved.source,
          priceModel: activityType.priceModel,
        });
      }
      throw e;
    }
  }),
);

// Draft-rule preview (Slice B). Computes ONE rule's price for a participant
// count using the same engine math (baseAmountMinor + splitVat) — NO resolution,
// NO DB, NO writes. The business Pricing UI uses this for the per-card quote-style
// preview, so the numbers always match the real engine. activityType is NOT
// required here because the rule's own priceModel drives the math.
router.post(
  '/preview',
  handle(async (req, res) => {
    const b = req.body || {};
    const rule = {
      priceModel: b.priceModel,
      adultPriceMinor: b.adultPriceMinor ?? null,
      childPriceMinor: b.childPriceMinor ?? null,
      basePriceMinor: b.basePriceMinor ?? null,
      baseParticipants: b.baseParticipants ?? null,
      perAdditionalParticipantMinor: b.perAdditionalParticipantMinor ?? null,
      fixedPriceMinor: b.fixedPriceMinor ?? null,
      tiers: Array.isArray(b.tiers) ? b.tiers : [],
      ticketPrices: Array.isArray(b.ticketPrices) ? b.ticketPrices : [],
    };
    const counts = {
      adultCount: b.adultCount,
      childCount: b.childCount,
      participantCount: b.participantCount,
      groupCount: b.groupCount != null ? b.groupCount : 1,
      ticketQuantities: b.ticketQuantities || {},
    };
    const vatMode = b.vatMode === 'excluded' ? 'excluded' : 'included';
    const vatRate = b.vatRate != null ? Number(b.vatRate) : 18;
    try {
      const { amountMinor, debug } = baseAmountMinor(rule, counts);
      const vat = splitVat(amountMinor, vatMode, vatRate);
      return res.json({
        ok: true,
        priceModel: rule.priceModel,
        vatMode,
        vatRate,
        baseAmountMinor: amountMinor,
        netMinor: vat.netMinor,
        vatMinor: vat.vatMinor,
        grossMinor: vat.grossMinor,
        debug,
      });
    } catch (e) {
      if (e instanceof PricingError)
        return res.json({ ok: false, error: e.code, details: e.details });
      throw e;
    }
  }),
);

export default router;
