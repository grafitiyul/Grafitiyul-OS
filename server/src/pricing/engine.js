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
// (null scope = wildcard) AND the rule's price model matches the context model.
function ruleMatches(rule, ctx, priceModel) {
  if (!rule.active) return false;
  if (rule.priceModel !== priceModel) return false;
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
// number of groups.
function baseAmountMinor(rule, counts) {
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
    // participantCount preferred; fall back to adult+child if only those given.
    const participantCount = Math.max(
      0,
      Number(
        counts.participantCount != null
          ? counts.participantCount
          : (Number(counts.adultCount) || 0) + (Number(counts.childCount) || 0),
      ) || 0,
    );
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

  throw new PricingError('unknown_price_model', { priceModel: rule.priceModel });
}

// Split a VAT-inclusive or VAT-exclusive amount into net / vat / gross.
export function splitVat(amountMinor, vatMode, vatRate) {
  const rate = Number(vatRate) || 0;
  if (vatMode === 'included') {
    const grossMinor = Math.round(amountMinor);
    const netMinor = Math.round(grossMinor / (1 + rate / 100));
    return { netMinor, vatMinor: grossMinor - netMinor, grossMinor };
  }
  // 'excluded' (default for anything not 'included')
  const netMinor = Math.round(amountMinor);
  const vatMinor = Math.round((netMinor * rate) / 100);
  return { netMinor, vatMinor, grossMinor: netMinor + vatMinor };
}

// Full calculation. `priceList` (with `rules`), `activityType`, `context`, and
// `counts` are supplied by the caller. Returns a structured result or throws a
// PricingError with a clear `code`.
export function calculate({ priceList, activityType, context, counts }) {
  if (!activityType) throw new PricingError('activity_type_not_found');
  if (!priceList) throw new PricingError('no_price_list');

  const priceModel = activityType.priceModel; // per_head | tiered
  const candidates = (priceList.rules || []).filter((r) =>
    ruleMatches(r, context, priceModel),
  );
  const rule = selectRule(candidates);

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
