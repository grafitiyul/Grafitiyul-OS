// Pricing engine — Slice 2. Pure, deterministic resolution + VAT math. No DB
// access here: the route loads the price list + rules + activity type and hands
// them in, so this module is trivially testable.
//
// NOT wired to Deals. No DealLineItem, no Quotes. This computes a price for a
// given context only (used by the admin pricing calculator).

// Money is handled in integer MINOR units. Prisma returns BigInt for *Minor
// columns; we compute in Number (values are far below MAX_SAFE_INTEGER) and
// round to integer minor units, matching the API's BigInt→Number policy.

export class PricingError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.code = code;
    this.details = details;
  }
}

const num = (v) => (v == null ? null : Number(v));

// Count how many of a rule's four scopes are concrete (non-null). More concrete
// scopes = more specific = wins.
export function specificity(rule) {
  return (
    (rule.productId ? 1 : 0) +
    (rule.productVariantId ? 1 : 0) +
    (rule.activityTypeId ? 1 : 0) +
    (rule.organizationSubtypeId ? 1 : 0)
  );
}

// A rule matches the context when every NON-NULL scope equals the context value
// (null scope = wildcard). The price model is NOT a match criterion: each card
// chooses its own model (per_head | tiered | tiered_group | fixed), so the WINNING
// rule's own `priceModel` drives the computation. (Pre-Slice-A this was coupled to
// the activity type's priceModel; cards now own the model explicitly.)
function ruleMatches(rule, ctx) {
  if (!rule.active) return false;
  if (rule.productId && rule.productId !== ctx.productId) return false;
  if (rule.productVariantId && rule.productVariantId !== ctx.productVariantId)
    return false;
  if (rule.activityTypeId && rule.activityTypeId !== ctx.activityTypeId)
    return false;
  if (
    rule.organizationSubtypeId &&
    rule.organizationSubtypeId !== ctx.organizationSubtypeId
  )
    return false;
  return true;
}

// Deterministic winner selection: most specific → then highest priority → if
// still tied, it is genuinely ambiguous and we refuse to guess.
export function selectRule(candidates) {
  if (candidates.length === 0) {
    throw new PricingError('no_price_rule');
  }
  const ranked = [...candidates].sort((a, b) => {
    const sa = specificity(a);
    const sb = specificity(b);
    if (sa !== sb) return sb - sa; // more specific first
    return b.priority - a.priority; // higher priority first
  });
  const top = ranked[0];
  const tie = ranked.find(
    (r) =>
      r.id !== top.id &&
      specificity(r) === specificity(top) &&
      r.priority === top.priority,
  );
  if (tie) {
    throw new PricingError('ambiguous_price_rule', {
      ruleIds: [top.id, tie.id],
      specificity: specificity(top),
      priority: top.priority,
    });
  }
  return top;
}

// Base amount (in the rule's VAT terms) before the VAT split, multiplied by the
// number of groups. Exported so a draft-rule preview (the business Pricing UI's
// per-card calculator) can reuse the EXACT same math without going through rule
// resolution — one engine, no second implementation.
export function baseAmountMinor(rule, counts) {
  const groupCount = Math.max(1, Number(counts.groupCount) || 1);

  if (rule.priceModel === 'per_head') {
    if (num(rule.adultPriceMinor) == null && num(rule.childPriceMinor) == null) {
      throw new PricingError('rule_incomplete', {
        priceModel: 'per_head',
        missing: ['adultPriceMinor', 'childPriceMinor'],
      });
    }
    const adultCount = Math.max(0, Number(counts.adultCount) || 0);
    const childCount = Math.max(0, Number(counts.childCount) || 0);
    const perGroup =
      adultCount * (num(rule.adultPriceMinor) || 0) +
      childCount * (num(rule.childPriceMinor) || 0);
    return {
      amountMinor: Math.round(perGroup * groupCount),
      debug: { adultCount, childCount, groupCount, perGroupMinor: Math.round(perGroup) },
    };
  }

  if (rule.priceModel === 'tiered') {
    if (num(rule.basePriceMinor) == null) {
      throw new PricingError('rule_incomplete', {
        priceModel: 'tiered',
        missing: ['basePriceMinor'],
      });
    }
    const participantCount = resolveParticipantCount(counts);
    const baseParticipants = Math.max(0, num(rule.baseParticipants) || 0);
    const perAdd = num(rule.perAdditionalParticipantMinor) || 0;
    const extra = Math.max(0, participantCount - baseParticipants);
    const perGroup = (num(rule.basePriceMinor) || 0) + extra * perAdd;
    return {
      amountMinor: Math.round(perGroup * groupCount),
      debug: {
        participantCount,
        baseParticipants,
        extraParticipants: extra,
        groupCount,
        perGroupMinor: Math.round(perGroup),
      },
    };
  }

  // fixed — one flat total per group, independent of participant count.
  if (rule.priceModel === 'fixed') {
    if (num(rule.fixedPriceMinor) == null) {
      throw new PricingError('rule_incomplete', {
        priceModel: 'fixed',
        missing: ['fixedPriceMinor'],
      });
    }
    const perGroup = num(rule.fixedPriceMinor) || 0;
    return {
      amountMinor: Math.round(perGroup * groupCount),
      debug: { groupCount, perGroupMinor: Math.round(perGroup) },
    };
  }

  // tiered_group — model 1: an ordered ladder of (uptoParticipants → total group
  // price). Pick the first tier whose upper bound covers the group; above the
  // largest tier, add perAdditionalParticipantMinor per participant over it. The
  // tier prices are TOTALS for the whole group, not per-person.
  if (rule.priceModel === 'tiered_group') {
    const tiers = [...(rule.tiers || [])]
      .map((t) => ({
        uptoParticipants: Math.max(0, num(t.uptoParticipants) || 0),
        totalPriceMinor: num(t.totalPriceMinor) || 0,
        sortOrder: num(t.sortOrder) || 0,
      }))
      .sort(
        (a, b) =>
          a.uptoParticipants - b.uptoParticipants || a.sortOrder - b.sortOrder,
      );
    if (tiers.length === 0) {
      throw new PricingError('rule_incomplete', {
        priceModel: 'tiered_group',
        missing: ['tiers'],
      });
    }
    const participantCount = resolveParticipantCount(counts);
    const matchedTier = tiers.find(
      (t) => participantCount <= t.uptoParticipants,
    );
    let perGroup;
    let tierUpto;
    let tierTotalMinor;
    let extraParticipants = 0;
    if (matchedTier) {
      perGroup = matchedTier.totalPriceMinor;
      tierUpto = matchedTier.uptoParticipants;
      tierTotalMinor = matchedTier.totalPriceMinor;
    } else {
      // Above the largest tier: that tier's total + per-additional overflow.
      const last = tiers[tiers.length - 1];
      const perAdd = num(rule.perAdditionalParticipantMinor) || 0;
      extraParticipants = participantCount - last.uptoParticipants;
      perGroup = last.totalPriceMinor + extraParticipants * perAdd;
      tierUpto = last.uptoParticipants;
      tierTotalMinor = last.totalPriceMinor;
    }
    return {
      amountMinor: Math.round(perGroup * groupCount),
      debug: {
        participantCount,
        tierUpto,
        tierTotalMinor: Math.round(tierTotalMinor),
        extraParticipants,
        tierCount: tiers.length,
        groupCount,
        perGroupMinor: Math.round(perGroup),
      },
    };
  }

  // ticket_types — a configured price per ticket category (TicketType catalog).
  // Total = Σ (quantity[ticketTypeId] × configured priceMinor). Returns per-ticket
  // line items in debug so the UI can render a quote. No groupCount: ticket
  // quantities are absolute counts, not per-group.
  if (rule.priceModel === 'ticket_types') {
    const entries = rule.ticketPrices || [];
    if (entries.length === 0) {
      throw new PricingError('rule_incomplete', {
        priceModel: 'ticket_types',
        missing: ['ticketPrices'],
      });
    }
    const qtyMap = counts.ticketQuantities || {};
    let total = 0;
    const lines = [];
    for (const e of entries) {
      const quantity = Math.max(0, Number(qtyMap[e.ticketTypeId]) || 0);
      const priceMinor = num(e.priceMinor) || 0;
      const lineMinor = Math.round(quantity * priceMinor);
      total += lineMinor;
      lines.push({
        ticketTypeId: e.ticketTypeId,
        quantity,
        priceMinor: Math.round(priceMinor),
        lineMinor,
      });
    }
    return {
      amountMinor: Math.round(total),
      debug: { lines, ticketTypeCount: entries.length },
    };
  }

  throw new PricingError('unknown_price_model', { priceModel: rule.priceModel });
}

// participantCount preferred; fall back to adult+child if only those were given.
function resolveParticipantCount(counts) {
  return Math.max(
    0,
    Number(
      counts.participantCount != null
        ? counts.participantCount
        : (Number(counts.adultCount) || 0) + (Number(counts.childCount) || 0),
    ) || 0,
  );
}

// Split an amount into net / vat / gross according to the VAT mode:
//   included — the amount already contains VAT (extract it).
//   excluded — VAT is added on top of the amount ("VAT added").
//   exempt   — no VAT at all (net = gross, vat = 0); rate is ignored.
export function splitVat(amountMinor, vatMode, vatRate) {
  const rate = Number(vatRate) || 0;
  if (vatMode === 'exempt') {
    const v = Math.round(amountMinor);
    return { netMinor: v, vatMinor: 0, grossMinor: v };
  }
  if (vatMode === 'included') {
    const grossMinor = Math.round(amountMinor);
    const netMinor = Math.round(grossMinor / (1 + rate / 100));
    return { netMinor, vatMinor: grossMinor - netMinor, grossMinor };
  }
  // 'excluded' (default for anything not 'included'/'exempt')
  const netMinor = Math.round(amountMinor);
  const vatMinor = Math.round((netMinor * rate) / 100);
  return { netMinor, vatMinor, grossMinor: netMinor + vatMinor };
}

// ── Add-ons (card-level) ────────────────────────────────────────────────────
// Add-ons are SEPARATE quote lines on top of the model base. Each carries its own
// price + VAT (or inherits the card's), so the quote total is the SUM of per-line
// VAT splits — these pure helpers reuse splitVat; core resolution is untouched.

// Effective VAT for one add-on: null mode inherits the card's mode+rate; an
// explicit mode uses its own rate (exempt forces 0).
function effectiveAddonVat(entry, cardVat) {
  if (entry.vatMode == null) {
    return { vatMode: cardVat.vatMode, vatRate: cardVat.vatRate };
  }
  if (entry.vatMode === 'exempt') return { vatMode: 'exempt', vatRate: 0 };
  return { vatMode: entry.vatMode, vatRate: entry.vatRate != null ? entry.vatRate : 18 };
}

// Does an add-on apply in this context?
//   enabled=false      → never
//   'weekdays'         → ctx.weekday (0=Sun..6=Sat) is in autoApplyWeekdays
//   'sabbath_holiday'  → ctx.isSabbathHoliday (computed by the caller via
//                        sabbathHolidayWindow — the ONE detector, never duplicated)
//   'manual'           → ctx.manualAddonIds includes this addonId
export function addonApplies(entry, ctx = {}) {
  if (entry.enabled === false) return false;
  if (entry.autoApply === 'weekdays') {
    return (
      Array.isArray(entry.autoApplyWeekdays) &&
      ctx.weekday != null &&
      entry.autoApplyWeekdays.map(Number).includes(Number(ctx.weekday))
    );
  }
  if (entry.autoApply === 'sabbath_holiday') {
    return ctx.isSabbathHoliday === true;
  }
  return Array.isArray(ctx.manualAddonIds) && ctx.manualAddonIds.includes(entry.addonId);
}

// Resolve the effective entry for a SYSTEM add-on (e.g. שבת/חג) on one card from
// the catalog default ⊕ an optional per-card override. The single source of truth
// for inherit↔override — reused by the preview route now and Deals/Quotes later.
//   - Addon.active is a GLOBAL kill-switch (inactive → no surcharge anywhere).
//   - override null fields inherit the catalog default; concrete fields override.
//   - override.enabled=false disables for that card (cannot force-enable globally).
//   - autoApply is always 'sabbath_holiday' (timing comes from שעות שבת וחג).
// Returns a concrete add-on entry, or null when it should not apply at all
// (globally inactive, card-disabled, or effective price ≤ 0).
export function resolveSystemAddonEntry(systemAddon, override) {
  if (!systemAddon || systemAddon.active === false) return null;
  if (override && override.enabled === false) return null;
  const priceMinor =
    override && override.priceMinor != null
      ? Number(override.priceMinor)
      : Number(systemAddon.defaultPriceMinor) || 0;
  if (!(priceMinor > 0)) return null;
  return {
    addonId: systemAddon.id,
    enabled: true,
    priceMinor,
    vatMode: override && override.vatMode ? override.vatMode : systemAddon.vatMode,
    vatRate: override && override.vatRate != null ? override.vatRate : systemAddon.vatRate,
    autoApply: 'sabbath_holiday',
  };
}

// Price one add-on line into net/vat/gross using its effective VAT.
export function priceAddon(entry, cardVat) {
  const ev = effectiveAddonVat(entry, cardVat);
  const vat = splitVat(num(entry.priceMinor) || 0, ev.vatMode, ev.vatRate);
  return {
    addonId: entry.addonId,
    priceMinor: Math.round(num(entry.priceMinor) || 0),
    vatMode: ev.vatMode,
    vatRate: ev.vatRate,
    netMinor: vat.netMinor,
    vatMinor: vat.vatMinor,
    grossMinor: vat.grossMinor,
  };
}

// ── שעות שבת וחג detection ──────────────────────────────────────────────────
// Pure: given a normalized moment and the active rules, decide whether it falls
// in a שבת/חג/ערב-חג window. The route normalizes a datetime (Israel local) into
// { weekday 0-6, minuteOfDay 0-1439, dateISO 'YYYY-MM-DD' } and loads the rules.
// Only APPROVED + active holidays count — pending/ignored never affect pricing.
// NOT wired to pricing yet; this is the detector a later slice feeds into
// addonApplies for autoApply='sabbath_holiday'.
function inWindow(minute, startMinute, endMinute) {
  const s = startMinute == null ? 0 : Number(startMinute);
  const e = endMinute == null ? 1439 : Number(endMinute);
  return minute >= s && minute <= e;
}

// Classification strength: שבת (weekly) is strongest, then חג, then ערב חג, then
// other. When several windows cover the same moment (e.g. ערב חג that falls on a
// Saturday), the STRONGEST wins — so a Saturday is treated as שבת, not ערב חג.
const SABBATH_TYPE_RANK = { shabbat: 4, chag: 3, erev_chag: 2, other: 1 };

export function sabbathHolidayWindow(ctx, rules = {}) {
  const minute = Number(ctx.minuteOfDay) || 0;
  const matched = [];
  for (const r of rules.weekly || []) {
    if (r.active === false) continue;
    if (Number(r.dayOfWeek) !== Number(ctx.weekday)) continue;
    if (r.allDay || inWindow(minute, r.startMinute, r.endMinute)) {
      matched.push({ type: 'shabbat', label: r.nameHe, source: 'weekly' });
    }
  }
  for (const h of rules.holidays || []) {
    if (h.active === false || h.status !== 'approved') continue;
    if (String(h.date).slice(0, 10) !== ctx.dateISO) continue;
    if (h.allDay || inWindow(minute, h.startMinute, h.endMinute)) {
      matched.push({ type: h.type, label: h.nameHe, source: 'holiday' });
    }
  }
  if (matched.length === 0) return { applies: false, matched: [] };
  // Strongest classification wins; `matched` is returned for debug/explanation.
  matched.sort((a, b) => (SABBATH_TYPE_RANK[b.type] || 0) - (SABBATH_TYPE_RANK[a.type] || 0));
  const top = matched[0];
  return { applies: true, type: top.type, label: top.label, matched };
}

// Full calculation. `priceList` (with `rules`), `activityType`, `context`, and
// `counts` are supplied by the caller. Returns a structured result or throws a
// PricingError with a clear `code`.
export function calculate({ priceList, activityType, context, counts }) {
  if (!activityType) throw new PricingError('activity_type_not_found');
  if (!priceList) throw new PricingError('no_price_list');

  // Match on SCOPE only; the winning rule owns its price model.
  const candidates = (priceList.rules || []).filter((r) =>
    ruleMatches(r, context),
  );
  const rule = selectRule(candidates);
  const priceModel = rule.priceModel; // per_head | tiered | tiered_group | fixed

  const { amountMinor, debug } = baseAmountMinor(rule, counts);

  // Effective VAT: rule override wins, else price-list default. Note 0 is a
  // valid rate, so test against null explicitly.
  const vatMode = rule.vatMode != null ? rule.vatMode : priceList.defaultVatMode;
  const vatRate = rule.vatRate != null ? rule.vatRate : priceList.defaultVatRate;
  const vat = splitVat(amountMinor, vatMode, vatRate);

  return {
    ok: true,
    priceList: {
      id: priceList.id,
      nameHe: priceList.nameHe,
      nameEn: priceList.nameEn,
      currency: priceList.currency,
      isDefault: priceList.isDefault,
    },
    rule: {
      id: rule.id,
      priceModel: rule.priceModel,
      specificity: specificity(rule),
      priority: rule.priority,
      scopes: {
        productId: rule.productId,
        productVariantId: rule.productVariantId,
        activityTypeId: rule.activityTypeId,
        organizationSubtypeId: rule.organizationSubtypeId,
      },
    },
    priceModel,
    currency: priceList.currency,
    vatMode,
    vatRate,
    netMinor: vat.netMinor,
    vatMinor: vat.vatMinor,
    grossMinor: vat.grossMinor,
    debug: {
      candidateCount: candidates.length,
      ...debug,
      baseAmountMinor: amountMinor,
    },
  };
}
