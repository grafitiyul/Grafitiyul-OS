import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { calculate, baseAmountMinor, splitVat, priceAddon, addonApplies, sabbathHolidayWindow, resolveSystemAddonEntry, PricingError } from '../pricing/engine.js';
import { buildGroupCards } from '../pricing/groupTicketCards.js';

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
    // 'exempt' (פטור) must be honored here too, else the preview would extract
    // VAT as if the price were VAT-inclusive. splitVat handles exempt (vat=0).
    const vatMode = b.vatMode === 'excluded' || b.vatMode === 'exempt' ? b.vatMode : 'included';
    const vatRate = vatMode === 'exempt' ? 0 : b.vatRate != null ? Number(b.vatRate) : 18;
    try {
      const { amountMinor, debug } = baseAmountMinor(rule, counts);
      const vat = splitVat(amountMinor, vatMode, vatRate);

      // Add-ons are SEPARATE lines on top of the base, included only if they
      // apply (manual toggle, weekday match, or שבת/חג window). Each splits VAT on
      // its own. Auto-apply context is derived from an optional date+time:
      // weekday from the date; minute-of-day from the time; the שבת/חג decision
      // comes from the ONE detector (sabbathHolidayWindow) fed by the global rules
      // — never re-implemented here.
      const addonEntries = Array.isArray(b.addons) ? b.addons.slice() : [];

      // The שבת/חג surcharge is a SYSTEM add-on inherited by EVERY card. Resolve
      // its effective entry from the catalog default ⊕ this card's optional
      // override (sent as an entry with the system addonId). The resolver is the
      // single source of inherit↔override + the global kill-switch. Replacing any
      // raw override with the resolved entry means a non-overridden card (no row)
      // still gets the current catalog default.
      const systemAddon = await prisma.addon.findFirst({ where: { systemKey: 'sabbath_holiday' } });
      if (systemAddon) {
        const idx = addonEntries.findIndex((e) => e.addonId === systemAddon.id);
        const override = idx >= 0 ? addonEntries[idx] : null;
        if (idx >= 0) addonEntries.splice(idx, 1);
        const resolved = resolveSystemAddonEntry(systemAddon, override);
        if (resolved) addonEntries.push(resolved);
      }

      const dateISO = b.date ? String(b.date).slice(0, 10) : null;
      let weekday = b.weekday != null && b.weekday !== '' ? Number(b.weekday) : null;
      let minuteOfDay = null;
      if (dateISO) {
        const dt = new Date(`${dateISO}T00:00:00Z`);
        if (!Number.isNaN(dt.getTime())) weekday = dt.getUTCDay();
      }
      if (b.time) {
        const [hh, mm] = String(b.time).split(':').map(Number);
        if (Number.isFinite(hh) && Number.isFinite(mm)) minuteOfDay = hh * 60 + mm;
      }

      let sabbathHoliday = { applies: false };
      if (dateISO && addonEntries.some((e) => e.autoApply === 'sabbath_holiday')) {
        const [weekly, holidays] = await Promise.all([
          prisma.sabbathWeeklyRule.findMany({ where: { active: true } }),
          prisma.holidayRule.findMany({ where: { active: true, status: 'approved' } }),
        ]);
        sabbathHoliday = sabbathHolidayWindow(
          { weekday, minuteOfDay: minuteOfDay ?? 0, dateISO },
          { weekly, holidays },
        );
      }

      const cardVat = { vatMode, vatRate };
      const ctx = {
        weekday,
        minuteOfDay,
        manualAddonIds: Array.isArray(b.manualAddonIds) ? b.manualAddonIds : [],
        isSabbathHoliday: sabbathHoliday.applies,
      };
      // Each add-on's effective VAT resolves entry-override → catalog → card, so
      // load the catalog vatMode for every referenced add-on (incl. the system one).
      const appliedEntries = addonEntries.filter((e) => addonApplies(e, ctx));
      const addonIds = [...new Set(appliedEntries.map((e) => e.addonId).filter(Boolean))];
      const catalogRows = addonIds.length
        ? await prisma.addon.findMany({ where: { id: { in: addonIds } }, select: { id: true, vatMode: true, vatRate: true } })
        : [];
      const catalogVatById = new Map(catalogRows.map((a) => [a.id, { vatMode: a.vatMode, vatRate: a.vatRate }]));
      const addonLines = appliedEntries.map((e) => priceAddon(e, cardVat, catalogVatById.get(e.addonId)));
      const sum = (key) => addonLines.reduce((s, l) => s + l[key], 0);

      return res.json({
        ok: true,
        priceModel: rule.priceModel,
        vatMode,
        vatRate,
        baseAmountMinor: amountMinor,
        netMinor: vat.netMinor,
        vatMinor: vat.vatMinor,
        grossMinor: vat.grossMinor,
        addonLines,
        totalNetMinor: vat.netMinor + sum('netMinor'),
        totalVatMinor: vat.vatMinor + sum('vatMinor'),
        totalGrossMinor: vat.grossMinor + sum('grossMinor'),
        sabbathHoliday, // { applies, label?, type? } — explains the שבת/חג decision
        debug,
      });
    } catch (e) {
      if (e instanceof PricingError)
        return res.json({ ok: false, error: e.code, details: e.details });
      throw e;
    }
  }),
);

// ── Price Builder (Deal base-price editor) ──────────────────────────────────
// Computes a multi-line price for ONE deal, reusing the engine end to end:
//   • the product line is resolved via calculate() (price list + rule + VAT);
//   • every line's net/vat/gross uses splitVat — the ONE VAT implementation;
//   • an ambiguous rule returns the conflicting rules (scopes/model) so the UI can
//     EXPLAIN the conflict instead of dead-ending (the user can override meanwhile).
// No quote/version storage — the caller persists the lines JSON on the Deal.

const SIGN = (kind) => (kind === 'discount' || kind === 'credit' ? -1 : 1);

router.post(
  '/builder',
  handle(async (req, res) => {
    const b = req.body || {};
    const c = b.context || {};
    const context = {
      productId: c.productId || null,
      productVariantId: c.productVariantId || null,
      activityTypeId: c.activityTypeId || null,
      organizationTypeId: c.organizationTypeId || null,
      organizationSubtypeId: c.organizationSubtypeId || null,
    };
    const counts = {
      participantCount: c.participantCount,
      adultCount: c.adultCount != null ? c.adultCount : c.participantCount,
      childCount: c.childCount,
      groupCount: c.groupCount != null ? c.groupCount : 1,
    };
    const inputLines = Array.isArray(b.lines) ? b.lines : [];

    // Applicable price list (subtype → type → system default) for the VAT default
    // and the product-line resolution.
    const resolvedList = await resolvePriceListId(context);
    const priceList = resolvedList
      ? await prisma.priceList.findUnique({
          where: { id: resolvedList.id },
          include: {
            rules: {
              where: { active: true },
              include: { tiers: { orderBy: { sortOrder: 'asc' } }, ticketPrices: true },
            },
          },
        })
      : null;
    const vatDefault = {
      mode: priceList?.defaultVatMode || 'included',
      rate: priceList?.defaultVatRate != null ? priceList.defaultVatRate : 18,
    };

    // Product-line resolution (explanation + conflict details).
    let productResolution = { ok: false, error: 'no_product' };
    if (!context.productVariantId) {
      productResolution = { ok: false, error: 'no_product' };
    } else if (!context.activityTypeId) {
      productResolution = { ok: false, error: 'activity_type_required' };
    } else if (!priceList) {
      productResolution = { ok: false, error: 'no_price_list' };
    } else {
      const activityType = await prisma.activityType.findUnique({
        where: { id: context.activityTypeId },
      });
      if (!activityType) productResolution = { ok: false, error: 'activity_type_not_found' };
      else {
        try {
          const r = calculate({ priceList, activityType, context, counts });
          productResolution = {
            ok: true,
            priceList: { id: priceList.id, nameHe: priceList.nameHe },
            priceListSource: resolvedList.source,
            priceModel: r.priceModel,
            vatMode: r.vatMode,
            vatRate: r.vatRate,
            // Per-unit base in the rule's VAT terms (qty 1) — the product line's
            // unit price. Multiplying by quantity + splitVat reproduces the engine
            // result for qty 1 and scales linearly for more.
            baseAmountMinor: r.debug?.baseAmountMinor ?? r.grossMinor,
            netMinor: r.netMinor,
            vatMinor: r.vatMinor,
            grossMinor: r.grossMinor,
          };
        } catch (e) {
          if (!(e instanceof PricingError)) throw e;
          productResolution = {
            ok: false,
            error: e.code,
            details: e.details || {},
            priceList: { id: priceList.id, nameHe: priceList.nameHe },
          };
          if (e.code === 'ambiguous_price_rule' && Array.isArray(e.details?.ruleIds)) {
            const rules = await prisma.priceRule.findMany({
              where: { id: { in: e.details.ruleIds } },
              include: {
                product: { select: { nameHe: true } },
                productVariant: { select: { location: { select: { nameHe: true } } } },
                activityType: { select: { nameHe: true } },
                organizationSubtype: { select: { label: true } },
              },
            });
            productResolution.conflictRules = rules.map((r) => ({
              id: r.id,
              priceModel: r.priceModel,
              priority: r.priority,
              scope: {
                product: r.product?.nameHe || null,
                location: r.productVariant?.location?.nameHe || null,
                activityType: r.activityType?.nameHe || null,
                organizationSubtype: r.organizationSubtype?.label || null,
              },
            }));
          }
        }
      }
    }

    // Compose every line into net/vat/gross. The product line uses the engine's
    // own split when resolved & not overridden; otherwise splitVat the line amount.
    const lines = inputLines.map((ln) => {
      const kind = ln.kind || 'manual';
      const isProduct = kind === 'product';
      const active = ln.active !== false;
      const engineProduct = isProduct && !ln.overridden && productResolution.ok;
      // Quantity applies to EVERY line (the product line included — this was the
      // qty×price bug). Default 1 when unset.
      let quantity = parseInt(ln.quantity, 10);
      if (!Number.isFinite(quantity) || quantity < 0) quantity = 1;

      // Per-unit price + effective VAT. The product line's unit is the engine's
      // per-unit base (rule VAT terms) unless overridden; an explicit (non-inherit)
      // VAT mode on the line wins so the toolbar VAT choice applies to it too.
      let unitPriceMinor;
      let effMode;
      let effRate;
      if (engineProduct) {
        unitPriceMinor = Number(productResolution.baseAmountMinor) || 0;
        effMode = ln.vatMode && ln.vatMode !== 'inherit' ? ln.vatMode : productResolution.vatMode;
        effRate = effMode === 'exempt' ? 0 : productResolution.vatRate != null ? productResolution.vatRate : vatDefault.rate;
      } else {
        unitPriceMinor = Number(ln.unitPriceMinor) || 0;
        effMode = !ln.vatMode || ln.vatMode === 'inherit' ? vatDefault.mode : ln.vatMode;
        effRate = effMode === 'exempt' ? 0 : ln.vatRate != null ? Number(ln.vatRate) : vatDefault.rate;
      }

      // Single, uniform calc for all lines: amount = sign × unit × quantity → VAT split.
      let net = 0;
      let vat = 0;
      let gross = 0;
      if (active) {
        const amount = SIGN(kind) * unitPriceMinor * quantity;
        const s = splitVat(amount, effMode, effRate);
        net = s.netMinor;
        vat = s.vatMinor;
        gross = s.grossMinor;
      }

      return {
        id: ln.id,
        kind,
        label: ln.label || '',
        refId: ln.refId || null,
        note: ln.note || '',
        active,
        overridden: !!ln.overridden,
        quantity,
        unitPriceMinor,
        vatMode: ln.vatMode || 'inherit',
        vatRate: ln.vatRate != null ? ln.vatRate : null,
        effectiveVatMode: effMode,
        effectiveVatRate: effRate,
        netMinor: net,
        vatMinor: vat,
        grossMinor: gross,
      };
    });

    const totals = lines.reduce(
      (t, l) => ({
        netMinor: t.netMinor + l.netMinor,
        vatMinor: t.vatMinor + l.vatMinor,
        grossMinor: t.grossMinor + l.grossMinor,
      }),
      { netMinor: 0, vatMinor: 0, grossMinor: 0 },
    );

    res.json({ ok: true, vatDefault, productResolution, lines, totals });
  }),
);

// ── Group Ticket Builder — the enabled Pricing Cards (business authority) ────
// The OWNER opts a Pricing Card into Group Ticket Sales and ONLY the flag decides
// which cards arrive here — no filter by product, city, activity, segment, or any
// hardcoded rule. The pure transform (buildGroupCards) enforces the rest: only
// ticket-structured cards become sellable rows, with NO fabricated fallbacks, and
// unconfigured cards are surfaced separately for an explicit admin warning.
router.get(
  '/group-cards',
  handle(async (req, res) => {
    const rules = await prisma.priceRule.findMany({
      where: { availableForGroupTickets: true, active: true },
      orderBy: [{ cardSortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        product: { select: { nameHe: true } },
        ticketPrices: { include: { ticketType: { select: { nameHe: true, sortOrder: true } } } },
      },
    });
    res.json(buildGroupCards(rules));
  }),
);

export default router;
