// Agent-reservation pricing resolver — the reservation form's ONLY pricing
// source. Reuses the canonical engine end to end (calculate + the shared
// eligibility gate + the shared auto add-on resolver + the shared structure
// formatter). It resolves the Agents-segment (`key='agents'`) pricing card for a
// product/variant and returns a SAFE, structured, read-only display model. It
// creates nothing and mutates nothing.
//
// Fallback is a deliberate business behavior: a product with no eligible Agents
// card returns the exact Hebrew message below — never a guess, never another
// segment's price. This makes future products "agent-priced by data alone":
// linking a product to the Agents segment with a valid card is all it takes.

import { calculate, splitVat } from './engine.js';
import { probeCard } from './cardOptions.js';
import { describeStructure, describeSurcharges } from './pricingDisplay.js';
import { loadAndBuildAutoAddons } from './resolveAutoAddons.js';

export const AGENT_PRICE_FALLBACK_HE =
  'החישוב האוטומטי של המחיר לא זמין למוצר זה, המחיר יהיה כפי שכתוב במחירון לסוכנים.';

function fallback(reason) {
  return { available: false, reason, messageHe: AGENT_PRICE_FALLBACK_HE };
}

export async function resolveAgentPricing(prisma, { productVariantId, participants, tourDate, tourTime }) {
  if (!productVariantId) return fallback('no_variant');
  const variant = await prisma.productVariant.findUnique({
    where: { id: productVariantId },
    select: { id: true, productId: true },
  });
  if (!variant) return fallback('no_variant');

  const defList = await prisma.priceList.findFirst({
    where: { isDefault: true },
    select: { id: true, defaultVatMode: true, defaultVatRate: true },
  });
  if (!defList) return fallback('no_price_list');
  const agentsSeg = await prisma.pricingSegment.findFirst({ where: { key: 'agents' }, select: { id: true } });
  if (!agentsSeg) return fallback('no_agents_segment');

  // Only the Agents cards for this product — no cross-segment fallback ever.
  const priceList = await prisma.priceList.findUnique({
    where: { id: defList.id },
    select: {
      id: true,
      defaultVatMode: true,
      defaultVatRate: true,
      rules: {
        where: { active: true, pricingSegmentId: agentsSeg.id, productId: variant.productId },
        orderBy: [{ cardSortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        include: {
          tiers: { orderBy: { sortOrder: 'asc' } },
          ticketPrices: { include: { ticketType: { select: { nameHe: true } } } },
          addons: { orderBy: { sortOrder: 'asc' } },
        },
      },
    },
  });
  if (!priceList || priceList.rules.length === 0) return fallback('no_agents_card');

  const pCount = Math.max(0, Number(participants) || 0);
  const context = { productId: variant.productId, productVariantId, activityTypeId: null };

  // Pick the first ELIGIBLE agents card (same canonical gate as the Builder
  // selector). Pin ignores activityType for math but calculate needs it
  // non-null → use the card's own activity scope. Remember an incomplete card
  // so we can log it and show the safe fallback (invalid config ≠ no card).
  const cardIds = [...new Set(priceList.rules.map((r) => r.cardGroupId).filter(Boolean))];
  let chosen = null;
  let invalid = null;
  for (const cardGroupId of cardIds) {
    const sample = priceList.rules.find((r) => r.cardGroupId === cardGroupId);
    const activityType = { id: sample.activityTypeId || '_agents_probe_' };
    const probe = probeCard({
      priceList,
      activityType,
      context,
      counts: { participantCount: Math.max(1, pCount), adultCount: Math.max(1, pCount), groupCount: 1 },
      cardGroupId,
    });
    if (probe.ok) { chosen = { cardGroupId, activityType }; break; }
    if (probe.reason === 'rule_incomplete') invalid = { cardGroupId, reason: probe.reason };
  }
  if (!chosen) {
    if (invalid) {
      // Admin-facing detail in the server log ONLY — never leaked to the agent.
      console.warn(`[agentPricing] invalid Agents card config for product=${variant.productId}: card=${invalid.cardGroupId} reason=${invalid.reason}`);
      return { available: false, reason: 'invalid_config', messageHe: AGENT_PRICE_FALLBACK_HE };
    }
    return fallback('no_agents_card');
  }

  // Canonical price for this group (groups = 1: each reservation card is ONE
  // group and carries its OWN participant count — never another card's).
  const counts = { participantCount: pCount, adultCount: pCount, childCount: 0, groupCount: 1 };
  const engineResult = calculate({ priceList, activityType: chosen.activityType, context, counts, pinnedCardGroupId: chosen.cardGroupId });
  const winningRule = priceList.rules.find((r) => r.id === engineResult.rule.id);

  const { lines: autoLines } = await loadAndBuildAutoAddons(prisma, {
    winningRule,
    cardVat: { vatMode: engineResult.vatMode, vatRate: engineResult.vatRate },
    cardGroupId: chosen.cardGroupId,
    tourDate,
    tourTime,
    groupCount: 1,
  });

  const ticketNames = new Map((winningRule.ticketPrices || []).map((p) => [p.ticketTypeId, p.ticketType?.nameHe]));
  const structure = describeStructure(winningRule, ticketNames);
  const surcharges = describeSurcharges(autoLines);

  // Exact total = engine base gross (already VAT-split for this group's
  // participants) + each surcharge's VAT-split gross. Same numbers the Builder
  // produces; shown only with a real participant count and a total-able model.
  const participantsKnown = pCount >= 1;
  let totalMinor = null;
  if (participantsKnown && !structure.degraded && !structure.totalUnavailable) {
    let surchargeGross = 0;
    for (const l of autoLines) {
      const s = splitVat((Number(l.unitPriceMinor) || 0) * (Number(l.quantity) || 1), l.vatMode, l.vatRate);
      surchargeGross += s.grossMinor;
    }
    totalMinor = engineResult.grossMinor + surchargeGross;
  }

  return {
    available: true,
    priceModel: structure.priceModel,
    rows: structure.rows,
    surcharges,
    degraded: structure.degraded,
    participantsKnown,
    totalMinor,
  };
}
