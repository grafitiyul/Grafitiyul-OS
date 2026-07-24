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
import { describeApplied, describeStructure, describeSurcharges } from './pricingDisplay.js';
import { loadAndBuildAutoAddons } from './resolveAutoAddons.js';

export const AGENT_PRICE_FALLBACK_HE =
  'החישוב האוטומטי של המחיר לא זמין למוצר זה, המחיר יהיה כפי שכתוב במחירון לסוכנים.';

function fallback(reason) {
  return { available: false, reason, fallbackKey: 'agent_price_list', messageHe: AGENT_PRICE_FALLBACK_HE };
}

export async function resolveAgentPricing(prisma, { productVariantId, participants, groups, tourDate, tourTime, tourLanguage = null }) {
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
      return { available: false, reason: 'invalid_config', fallbackKey: 'agent_price_list', messageHe: AGENT_PRICE_FALLBACK_HE };
    }
    return fallback('no_agents_card');
  }

  // Canonical price for THIS reservation card: participants are the card's
  // TOTAL, "מספר מדריכים" is the pricing group count — the engine owns the
  // distribution (each card independent; nothing leaks between cards).
  const gCount = Math.max(1, Number(groups) || 1);
  const counts = { participantCount: pCount, adultCount: pCount, childCount: 0, groupCount: gCount };
  const engineResult = calculate({ priceList, activityType: chosen.activityType, context, counts, pinnedCardGroupId: chosen.cardGroupId });
  const winningRule = priceList.rules.find((r) => r.id === engineResult.rule.id);

  const { lines: autoLines, sabbath, systemAddonId } = await loadAndBuildAutoAddons(prisma, {
    winningRule,
    cardVat: { vatMode: engineResult.vatMode, vatRate: engineResult.vatRate },
    cardGroupId: chosen.cardGroupId,
    tourDate,
    tourTime,
    tourLanguage,
    groupCount: gCount,
  });
  const surchargeRows = describeSurcharges(autoLines, { systemAddonId, sabbathType: sabbath?.type || null });

  const ticketNames = new Map((winningRule.ticketPrices || []).map((p) => [p.ticketTypeId, p.ticketType?.nameHe]));
  const structure = describeStructure(winningRule, ticketNames);
  const participantsKnown = pCount >= 1;

  // EXACT mode: applied rows only (what the calculation actually used) plus a
  // structured VAT breakdown — subtotal + VAT reconcile to the total exactly
  // (base engine split + each surcharge's own split, all canonical).
  const applied = participantsKnown && !structure.totalUnavailable ? describeApplied(winningRule, engineResult) : null;
  if (applied) {
    let net = engineResult.netMinor;
    let vat = engineResult.vatMinor;
    let gross = engineResult.grossMinor;
    for (const l of autoLines) {
      const s = splitVat((Number(l.unitPriceMinor) || 0) * (Number(l.quantity) || 1), l.vatMode, l.vatRate);
      net += s.netMinor;
      vat += s.vatMinor;
      gross += s.grossMinor;
    }
    return {
      available: true,
      mode: 'exact',
      priceModel: structure.priceModel,
      rows: [...applied, ...surchargeRows],
      totals: { netMinor: net, vatMinor: vat, grossMinor: gross, vatMode: engineResult.vatMode, vatRate: engineResult.vatRate },
      missing: [],
    };
  }

  // STRUCTURAL mode: the card's structure (clearly not an applied calculation);
  // surcharge rows still shown when the date makes them apply. No totals.
  return {
    available: true,
    mode: 'structural',
    priceModel: structure.priceModel,
    rows: [...structure.rows, ...surchargeRows],
    totals: null,
    degraded: structure.degraded,
    missing: participantsKnown ? [] : ['participants'],
  };
}
