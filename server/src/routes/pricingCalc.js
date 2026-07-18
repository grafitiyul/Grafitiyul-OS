import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';
import { calculate, baseAmountMinor, splitVat, priceAddon, addonApplies, sabbathHolidayWindow, resolveSystemAddonEntry, PricingError } from '../pricing/engine.js';
import { buildGroupCards } from '../pricing/groupTicketCards.js';
import { composeBuilderLines } from '../pricing/builderCompose.js';
import { buildAutoAddonLines, tourMoment, AUTO_ADDON_SOURCE_KIND } from '../pricing/autoAddons.js';

// Pricing engine HTTP surface: /preview (per-card draft preview), /builder (the
// ONE multi-line calculation used by the Deal builders AND the pricing
// simulator) and /group-cards (Group Ticket Builder catalog). Admin-only.
//
// Dead-code removal (הגדרות מתקדמות cleanup): POST /calculate — the raw
// single-context test endpoint — served ONLY the retired advanced screen's
// calculator and was removed with it. The engine's calculate() itself lives on
// inside /builder's product resolution.

const router = Router();

// The DEFAULT price list (isDefault) is the LIVE pricing version — the one
// list resolution ever uses; the board's version settings flip it atomically.
//
// Removed (hidden-config cleanup): per-organization-type/subtype price-list
// overrides. They were never populated in production, had no UI, and per-org
// pricing is already expressed INSIDE the live list via the rules'
// organizationSubtypeId scope. The defaultPriceListId columns remain as inert
// legacy storage — nothing reads or writes them anymore.
async function resolvePriceListId() {
  const def = await prisma.priceList.findFirst({
    where: { isDefault: true },
    select: { id: true },
  });
  return def ? { id: def.id } : null;
}

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

      // ONE moment parser (shared with the builder's auto add-ons); the preview
      // additionally accepts an explicit weekday when no date is given.
      const moment = tourMoment(b.date, b.time);
      const dateISO = moment.dateISO;
      const weekday =
        moment.weekday != null
          ? moment.weekday
          : b.weekday != null && b.weekday !== ''
            ? Number(b.weekday)
            : null;
      const minuteOfDay = moment.minuteOfDay;

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
//
// `applyCardNotes: true` marks a (re)generation request: card-produced lines get
// their notes REBUILT from the current canonical Pricing Card `firstLineNote`
// templates (first line per card = the template, other card lines = empty).
// Plain recomputes omit the flag and echo user notes untouched.

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
      // Operational tour moment (Deal.tourDate/tourTime) — drives automatic
      // time-based add-ons (שבת/חג, weekday surcharges) on regeneration.
      tourDate: c.tourDate || null,
      tourTime: c.tourTime || null,
    };
    const counts = {
      participantCount: c.participantCount,
      adultCount: c.adultCount != null ? c.adultCount : c.participantCount,
      childCount: c.childCount,
      // Canonical operational group count (Deal.groups). Default 1.
      groupCount: c.groupCount != null ? c.groupCount : 1,
    };
    // Manual Pricing Card selection (option override) — carried on the product
    // line; automatic resolution stays the default when absent.
    const pinnedCardGroupId =
      c.pinnedCardGroupId ||
      (Array.isArray(b.lines) ? b.lines.find((l) => l?.kind === 'product')?.pinnedCardGroupId : null) ||
      null;
    const inputLines = Array.isArray(b.lines) ? b.lines : [];

    // The live (default) price list for the VAT default and product resolution.
    const resolvedList = await resolvePriceListId();
    const priceList = resolvedList
      ? await prisma.priceList.findUnique({
          where: { id: resolvedList.id },
          include: {
            rules: {
              where: { active: true },
              include: {
                tiers: { orderBy: { sortOrder: 'asc' } },
                ticketPrices: true,
                addons: { orderBy: { sortOrder: 'asc' } },
              },
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
          const r = calculate({ priceList, activityType, context, counts, pinnedCardGroupId });
          productResolution = {
            ok: true,
            priceList: { id: priceList.id, nameHe: priceList.nameHe },
            priceModel: r.priceModel,
            vatMode: r.vatMode,
            vatRate: r.vatRate,
            pinned: !!pinnedCardGroupId,
            // Card provenance + canonical first-line note of the WINNING rule —
            // the client stamps these on the generated product line so the note
            // is rebuilt from canonical card data on every regeneration.
            ruleId: r.rule.id,
            cardGroupId: r.rule.cardGroupId || null,
            firstLineNote: r.rule.firstLineNote || null,
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

    // Canonical first-line notes — loaded ONLY for a regeneration request. The
    // winning card's template comes from the resolution itself; templates for
    // every OTHER referenced card (group-ticket lines) come from any sibling rule
    // of that cardGroupId (the template is duplicated across siblings on save).
    const applyCardNotes = b.applyCardNotes === true;
    const noteByCard = new Map();
    if (applyCardNotes) {
      if (productResolution.ok && productResolution.cardGroupId)
        noteByCard.set(productResolution.cardGroupId, productResolution.firstLineNote);
      const missing = [
        ...new Set(inputLines.map((ln) => ln?.sourceCardGroupId).filter(Boolean)),
      ].filter((id) => !noteByCard.has(id));
      if (missing.length) {
        const reps = await prisma.priceRule.findMany({
          where: { cardGroupId: { in: missing } },
          orderBy: { createdAt: 'asc' },
          select: { cardGroupId: true, firstLineNote: true },
        });
        for (const r of reps) {
          if (!noteByCard.has(r.cardGroupId)) noteByCard.set(r.cardGroupId, r.firstLineNote);
        }
      }
    }

    // Automatic add-on lines — REGENERATION ONLY, for the winning card. Reuses
    // the exact engine primitives the per-card preview uses (the ONE שבת/חג
    // detector + addonApplies + priceAddon) — never re-implemented. Previous
    // auto lines in the input are dropped and rebuilt from CURRENT card data,
    // so a date change or card-config change never leaves a stale surcharge.
    let composeInput = inputLines;
    if (applyCardNotes) {
      composeInput = inputLines.filter((ln) => ln?.sourceKind !== AUTO_ADDON_SOURCE_KIND);
      if (productResolution.ok && productResolution.ruleId) {
        const winningRule = (priceList?.rules || []).find((r) => r.id === productResolution.ruleId);
        const systemAddon = await prisma.addon.findFirst({ where: { systemKey: 'sabbath_holiday' } });
        const moment = tourMoment(context.tourDate, context.tourTime);
        let sabbath = { applies: false };
        const entriesNeedSabbath =
          !!systemAddon || (winningRule?.addons || []).some((e) => e.autoApply === 'sabbath_holiday');
        if (moment.dateISO && entriesNeedSabbath) {
          const [weekly, holidays] = await Promise.all([
            prisma.sabbathWeeklyRule.findMany({ where: { active: true } }),
            prisma.holidayRule.findMany({ where: { active: true, status: 'approved' } }),
          ]);
          sabbath = sabbathHolidayWindow(
            { weekday: moment.weekday, minuteOfDay: moment.minuteOfDay ?? 0, dateISO: moment.dateISO },
            { weekly, holidays },
          );
        }
        const entryAddonIds = [
          ...new Set([...(winningRule?.addons || []).map((e) => e.addonId), systemAddon?.id].filter(Boolean)),
        ];
        const catalogRows = entryAddonIds.length
          ? await prisma.addon.findMany({
              where: { id: { in: entryAddonIds } },
              select: { id: true, nameHe: true, vatMode: true, vatRate: true },
            })
          : [];
        const autoLines = buildAutoAddonLines({
          ruleAddons: winningRule?.addons || [],
          systemAddon,
          cardVat: { vatMode: productResolution.vatMode, vatRate: productResolution.vatRate },
          cardGroupId: productResolution.cardGroupId,
          moment,
          isSabbathHoliday: sabbath.applies,
          addonCatalogById: new Map(catalogRows.map((a) => [a.id, a])),
        });
        if (autoLines.length) {
          // Insert directly AFTER the product line, so the product line stays the
          // card's FIRST line (first-line note) and ordering is deterministic.
          const idx = composeInput.findIndex((ln) => ln?.kind === 'product');
          composeInput =
            idx === -1
              ? [...autoLines, ...composeInput]
              : [...composeInput.slice(0, idx + 1), ...autoLines, ...composeInput.slice(idx + 1)];
        }
      }
    }

    // Card OPTIONS for the manual override picker: every active card that can
    // price this product (variant-compatible), regardless of org association —
    // association is only the automatic DEFAULT, any option is selectable.
    let cardOptions = [];
    if (context.productId && priceList) {
      const segNames = new Map(
        (await prisma.pricingSegment.findMany({ select: { id: true, nameHe: true } })).map((s) => [s.id, s.nameHe]),
      );
      const seen = new Map();
      for (const r of priceList.rules) {
        if (!r.cardGroupId || r.productId !== context.productId) continue;
        if (r.productVariantId && context.productVariantId && r.productVariantId !== context.productVariantId) continue;
        if (!seen.has(r.cardGroupId)) {
          seen.set(r.cardGroupId, {
            cardGroupId: r.cardGroupId,
            label: segNames.get(r.pricingSegmentId) || 'כרטיס תמחור',
          });
        }
      }
      cardOptions = [...seen.values()];
    }

    // ONE composition for every caller (Deal builders + pricing simulator).
    const { lines, totals } = composeBuilderLines({
      inputLines: composeInput,
      productResolution,
      vatDefault,
      applyCardNotes,
      noteByCard,
    });

    res.json({ ok: true, vatDefault, productResolution, cardOptions, lines, totals });
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
