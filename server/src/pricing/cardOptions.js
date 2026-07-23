// Pricing-card OPTION eligibility — the ONE canonical rule for which cards may
// appear as a selectable Builder pricing candidate, and the SAME rule the agent
// pricing resolver uses to pick a segment card. Pure (calls the engine, no IO).
//
// A card is ELIGIBLE for a context when PINNING it and running the canonical
// engine yields a real, positive price. This single rule subsumes every failure
// the loose product/variant pre-filter used to let through as a silent no-op:
//   • the card has no sibling for the context variant  → pin throws → excluded
//   • the context has no variant at all                → pin throws → excluded
//   • the card's rule is incomplete (no tiers/price)   → engine throws → excluded
//   • a ticket_types (group) card in a non-group ctx   → resolves ₪0 → excluded
// so every option that DOES appear is guaranteed to calculate. Cards stay fully
// editable in the pricing admin UI regardless — eligibility gates only the
// Builder candidate list.
//
// Probe counts default to ≥1 so a context that hasn't entered participants yet
// still evaluates a card's ability to produce a price (not a transient ₪0).

import { calculate, PricingError } from './engine.js';

// Can this card price this context? Returns { ok, grossMinor } | { ok:false, reason }.
export function probeCard({ priceList, activityType, context, counts, cardGroupId }) {
  try {
    const r = calculate({ priceList, activityType, context, counts, pinnedCardGroupId: cardGroupId });
    return { ok: r.grossMinor > 0, grossMinor: r.grossMinor, priceModel: r.priceModel, reason: r.grossMinor > 0 ? null : 'zero_price' };
  } catch (e) {
    if (e instanceof PricingError) return { ok: false, reason: e.code };
    throw e;
  }
}

// Build the deterministic, eligible Builder card-option list for a context.
//   priceList     — the live list WITH .rules (each rule carries cardGroupId,
//                   pricingSegmentId, productId, productVariantId).
//   activityType  — resolved ActivityType (or null → nothing prices → []).
//   context       — { productId, productVariantId, activityTypeId, org* }.
//   counts        — { participantCount, groupCount } from the live context.
//   segNameById   — Map(pricingSegmentId → tab name) for the stable label.
// Label = the authoring TAB name (one stable source); genuine same-product+tab
// duplicates that ARE eligible get a deterministic ordinal, in the rules' order.
export function buildCardOptions({ priceList, activityType, context, counts, segNameById }) {
  if (!priceList || !context?.productId) return [];
  const probeParticipants = Math.max(1, Number(counts?.participantCount) || 0) || 1;
  const probeCounts = {
    participantCount: probeParticipants,
    // per_head prices by adultCount — the route derives it from participantCount;
    // the probe must too, or a per_head card falsely resolves ₪0 and is dropped.
    adultCount: probeParticipants,
    groupCount: Math.max(1, Number(counts?.groupCount) || 1),
  };
  const seen = new Set();
  const tabCount = new Map();
  const options = [];
  for (const r of priceList.rules || []) {
    if (!r.cardGroupId || r.productId !== context.productId) continue;
    if (seen.has(r.cardGroupId)) continue;
    seen.add(r.cardGroupId);
    const probe = probeCard({
      priceList,
      activityType,
      context,
      counts: probeCounts,
      cardGroupId: r.cardGroupId,
    });
    if (!probe.ok) continue; // canonical eligibility: must actually price
    const tab = segNameById.get(r.pricingSegmentId) || 'כרטיס תמחור';
    const n = (tabCount.get(tab) || 0) + 1;
    tabCount.set(tab, n);
    options.push({ cardGroupId: r.cardGroupId, label: n === 1 ? tab : `${tab} · ${n}` });
  }
  return options;
}
