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

// A card's representative price (canonical data) — the concise secondary
// descriptor that distinguishes genuine same-tab duplicates ("עסקי · ₪1,400"
// vs "עסקי · 2 · ₪1,700"). Never an internal id.
function representativePriceMinor(rule) {
  if (rule.priceModel === 'fixed') return rule.fixedPriceMinor != null ? Number(rule.fixedPriceMinor) : null;
  if (rule.priceModel === 'per_head') return rule.adultPriceMinor != null ? Number(rule.adultPriceMinor) : null;
  if (rule.priceModel === 'tiered') return rule.basePriceMinor != null ? Number(rule.basePriceMinor) : null;
  if (rule.priceModel === 'tiered_group') {
    const first = [...(rule.tiers || [])].sort((a, b) => (Number(a.uptoParticipants) || 0) - (Number(b.uptoParticipants) || 0))[0];
    return first ? Number(first.totalPriceMinor) : null;
  }
  return null;
}
const fmt = (minor) => `₪${(minor / 100).toLocaleString('en-US')}`;

// Build the deterministic card-option list for a context.
//
// Two explicit layers, because the Builder and the Simulator have different
// jobs (mode):
//   'applicable' (Builder, default) — a card is offered ONLY if pinning it and
//        running the engine yields a positive price for the CURRENT context
//        (variant + activity included). Every visible option calculates.
//   'config' (Simulator) — a card is offered if it is CONFIGURATION-VALID:
//        active and able to produce a positive price for its OWN scopes (the
//        card's variant/activity), regardless of the current context. This is
//        the admin inspection list — usable before a city/activity is chosen;
//        selecting a not-yet-applicable card yields an EXPLICIT message at
//        calculation time, never a silent no-op.
// Both probes run the same canonical engine — no second validity checker.
//
// Label = the authoring TAB name; genuine same-tab duplicates get a
// deterministic ordinal + a representative-price descriptor.
export function buildCardOptions({ priceList, activityType, context, counts, segNameById, mode = 'applicable' }) {
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
    const probe =
      mode === 'config'
        ? // Self-context: the card's own scopes prove its configuration.
          probeCard({
            priceList,
            activityType: { id: r.activityTypeId || '_config_probe_' },
            context: {
              productId: r.productId,
              productVariantId: r.productVariantId || null,
              activityTypeId: r.activityTypeId || '_config_probe_',
              organizationSubtypeId: r.organizationSubtypeId || null,
            },
            counts: probeCounts,
            cardGroupId: r.cardGroupId,
          })
        : probeCard({ priceList, activityType, context, counts: probeCounts, cardGroupId: r.cardGroupId });
    if (!probe.ok) continue;
    const tab = segNameById.get(r.pricingSegmentId) || 'כרטיס תמחור';
    const n = (tabCount.get(tab) || 0) + 1;
    tabCount.set(tab, n);
    const rep = representativePriceMinor(r);
    options.push({
      cardGroupId: r.cardGroupId,
      label: n === 1 ? tab : `${tab} · ${n}`,
      _tab: tab,
      _rep: rep,
    });
  }
  // Descriptor pass: only tabs that ended up with duplicates get the
  // representative-price suffix (kept out of `label` so the stable label
  // contract — "עסקי", "עסקי · 2" — is unchanged).
  for (const o of options) {
    o.descriptor = tabCount.get(o._tab) > 1 && o._rep != null ? fmt(o._rep) : null;
    delete o._tab;
    delete o._rep;
  }
  return options;
}
