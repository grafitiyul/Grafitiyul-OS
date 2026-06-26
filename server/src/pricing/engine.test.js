// Engine unit tests (Slice A). Pure math — no DB. Run with `npm test` (node:test).
//
// Covers: legacy per_head/tiered (regression), the new `fixed` and `tiered_group`
// models, the "model comes from the winning rule, not the activity type" change,
// VAT splitting, and the deterministic resolution guards.

import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, splitVat, selectRule, PricingError } from './engine.js';

// A minimal price list wrapper. VAT default excluded@0 so base math is visible
// 1:1 in net/gross unless a test overrides it.
function list(rules, overrides = {}) {
  return {
    id: 'pl1',
    nameHe: 'בדיקה',
    currency: 'ILS',
    isDefault: true,
    defaultVatMode: 'excluded',
    defaultVatRate: 0,
    rules,
    ...overrides,
  };
}

// activityType is intentionally given a CONFLICTING priceModel to prove the
// engine ignores it and reads the model off the winning rule.
const ACTIVITY = { id: 'at1', priceModel: 'per_head' };

function run(rules, counts, context = {}, listOverrides = {}) {
  return calculate({
    priceList: list(rules, listOverrides),
    activityType: ACTIVITY,
    context: { activityTypeId: 'at1', ...context },
    counts,
  });
}

// ── per_head (regression) ───────────────────────────────────────────────────
test('per_head: adult+child per person, ×groupCount', () => {
  const r = run(
    [{ id: 'r1', active: true, priceModel: 'per_head', adultPriceMinor: 10000n, childPriceMinor: 5000n, priority: 0 }],
    { adultCount: 3, childCount: 2, groupCount: 2 },
  );
  // (3*10000 + 2*5000) * 2 = 80000
  assert.equal(r.netMinor, 80000);
  assert.equal(r.priceModel, 'per_head');
});

// ── tiered (single-tier legacy, regression) ─────────────────────────────────
test('tiered: base up to N + per-additional above', () => {
  const r = run(
    [{ id: 'r1', active: true, priceModel: 'tiered', basePriceMinor: 100000n, baseParticipants: 10, perAdditionalParticipantMinor: 8000n, priority: 0 }],
    { participantCount: 13 },
  );
  // 100000 + 3*8000 = 124000
  assert.equal(r.netMinor, 124000);
});

// ── fixed (new) ─────────────────────────────────────────────────────────────
test('fixed: one flat total per group, count-independent', () => {
  const r = run(
    [{ id: 'r1', active: true, priceModel: 'fixed', fixedPriceMinor: 250000n, priority: 0 }],
    { participantCount: 99 },
  );
  assert.equal(r.netMinor, 250000);
});

test('fixed: ×groupCount', () => {
  const r = run(
    [{ id: 'r1', active: true, priceModel: 'fixed', fixedPriceMinor: 250000n, priority: 0 }],
    { participantCount: 5, groupCount: 3 },
  );
  assert.equal(r.netMinor, 750000);
});

test('fixed: missing price → rule_incomplete', () => {
  assert.throws(
    () => run([{ id: 'r1', active: true, priceModel: 'fixed', priority: 0 }], { participantCount: 5 }),
    (e) => e instanceof PricingError && e.code === 'rule_incomplete',
  );
});

// ── tiered_group (new — model 1) ────────────────────────────────────────────
// Ladder: up to 10 = 100000 total, up to 20 = 180000 total, above 20 = +15000 each.
const LADDER = {
  id: 'r1', active: true, priceModel: 'tiered_group', priority: 0,
  perAdditionalParticipantMinor: 15000n,
  tiers: [
    { uptoParticipants: 10, totalPriceMinor: 100000n, sortOrder: 0 },
    { uptoParticipants: 20, totalPriceMinor: 180000n, sortOrder: 1 },
  ],
};

test('tiered_group: within first tier → first total', () => {
  assert.equal(run([LADDER], { participantCount: 8 }).netMinor, 100000);
});
test('tiered_group: exactly at first tier bound → first total', () => {
  assert.equal(run([LADDER], { participantCount: 10 }).netMinor, 100000);
});
test('tiered_group: into second tier → second total', () => {
  assert.equal(run([LADDER], { participantCount: 15 }).netMinor, 180000);
});
test('tiered_group: exactly at top tier bound → second total', () => {
  assert.equal(run([LADDER], { participantCount: 20 }).netMinor, 180000);
});
test('tiered_group: above top tier → top total + overflow×perAdditional', () => {
  // 180000 + 3*15000 = 225000
  assert.equal(run([LADDER], { participantCount: 23 }).netMinor, 225000);
});
test('tiered_group: ×groupCount', () => {
  assert.equal(run([LADDER], { participantCount: 8, groupCount: 2 }).netMinor, 200000);
});
test('tiered_group: unsorted tiers are sorted before walking', () => {
  const unsorted = { ...LADDER, tiers: [LADDER.tiers[1], LADDER.tiers[0]] };
  assert.equal(run([unsorted], { participantCount: 8 }).netMinor, 100000);
});
test('tiered_group: no tiers → rule_incomplete', () => {
  assert.throws(
    () => run([{ id: 'r1', active: true, priceModel: 'tiered_group', tiers: [], priority: 0 }], { participantCount: 8 }),
    (e) => e instanceof PricingError && e.code === 'rule_incomplete',
  );
});

// ── model comes from the WINNING rule, not the activity type ────────────────
test('model is read from the resolved rule (activityType.priceModel ignored)', () => {
  // A specific tiered_group rule beats a wildcard per_head rule on specificity;
  // its OWN model must drive the math even though ACTIVITY.priceModel='per_head'.
  const specific = { ...LADDER, productId: 'p1' };
  const wildcard = { id: 'r2', active: true, priceModel: 'per_head', adultPriceMinor: 999999n, priority: 0 };
  const r = run([wildcard, specific], { participantCount: 8 }, { productId: 'p1' });
  assert.equal(r.priceModel, 'tiered_group');
  assert.equal(r.netMinor, 100000);
});

// ── VAT split ───────────────────────────────────────────────────────────────
test('VAT included: gross stays, net is back-computed', () => {
  const { netMinor, vatMinor, grossMinor } = splitVat(118000, 'included', 18);
  assert.equal(grossMinor, 118000);
  assert.equal(netMinor, 100000);
  assert.equal(vatMinor, 18000);
});
test('VAT excluded: vat added on top', () => {
  const { netMinor, vatMinor, grossMinor } = splitVat(100000, 'excluded', 18);
  assert.equal(netMinor, 100000);
  assert.equal(vatMinor, 18000);
  assert.equal(grossMinor, 118000);
});
test('rule VAT override beats price-list default', () => {
  const r = run(
    [{ id: 'r1', active: true, priceModel: 'fixed', fixedPriceMinor: 118000n, vatMode: 'included', vatRate: 18, priority: 0 }],
    { participantCount: 1 },
  );
  assert.equal(r.grossMinor, 118000);
  assert.equal(r.netMinor, 100000);
  assert.equal(r.vatMode, 'included');
});

// ── resolution guards ───────────────────────────────────────────────────────
test('no matching rule → no_price_rule', () => {
  assert.throws(
    () => run([], { participantCount: 1 }),
    (e) => e instanceof PricingError && e.code === 'no_price_rule',
  );
});
test('genuine tie (same specificity + priority) → ambiguous_price_rule', () => {
  const a = { id: 'a', active: true, priceModel: 'fixed', fixedPriceMinor: 1n, priority: 0 };
  const b = { id: 'b', active: true, priceModel: 'per_head', adultPriceMinor: 1n, priority: 0 };
  assert.throws(
    () => selectRule([a, b]),
    (e) => e instanceof PricingError && e.code === 'ambiguous_price_rule',
  );
});
test('higher priority breaks a specificity tie', () => {
  const lo = { id: 'lo', active: true, priceModel: 'fixed', fixedPriceMinor: 100n, priority: 0 };
  const hi = { id: 'hi', active: true, priceModel: 'fixed', fixedPriceMinor: 200n, priority: 5 };
  assert.equal(selectRule([lo, hi]).id, 'hi');
});
