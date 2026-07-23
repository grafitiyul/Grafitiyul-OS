// Agent pricing resolver (Part B) — integration over a mock prisma. Verifies
// the shared engine path, structure/surcharge/total assembly, Saturday
// surcharge, missing-card fallback, invalid-config fallback, and that a product
// newly linked to Agents "just works" from data.

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAgentPricing, AGENT_PRICE_FALLBACK_HE } from './agentPricing.js';

// Minimal prisma stub. `rules` are the Agents-segment rules for the product.
function mockPrisma({ variant = { id: 'v1', productId: 'p1' }, rules = [], sabbathWeekly = [], holidays = [], systemAddon = null, addonCatalog = [] } = {}) {
  return {
    productVariant: { findUnique: async () => variant },
    priceList: {
      findFirst: async () => ({ id: 'pl', defaultVatMode: 'included', defaultVatRate: 18 }),
      findUnique: async () => ({ id: 'pl', defaultVatMode: 'included', defaultVatRate: 18, rules }),
    },
    pricingSegment: { findFirst: async () => ({ id: 'seg_agents' }) },
    addon: {
      findFirst: async () => systemAddon,
      findMany: async () => addonCatalog,
    },
    sabbathWeeklyRule: { findMany: async () => sabbathWeekly },
    holidayRule: { findMany: async () => holidays },
  };
}

const agentsRule = (over = {}) => ({
  id: 'r1', active: true, cardGroupId: 'c_agents', pricingSegmentId: 'seg_agents',
  productId: 'p1', productVariantId: 'v1', activityTypeId: 'at1', cardSortOrder: 0,
  priceModel: 'fixed', fixedPriceMinor: 190000n, vatMode: 'included', vatRate: 18,
  tiers: [], ticketPrices: [], addons: [], ...over,
});

test('fixed Agents card → fixed row + exact total (participants known)', async () => {
  const m = await resolveAgentPricing(mockPrisma({ rules: [agentsRule()] }), { productVariantId: 'v1', participants: 8 });
  assert.equal(m.available, true);
  assert.equal(m.priceModel, 'fixed');
  assert.deepEqual(m.rows, [{ kind: 'fixed', labelHe: 'מחיר קבוע', amountMinor: 190000 }]);
  assert.equal(m.totalMinor, 190000); // fixed × 1 group
});

test('tiered_group Agents card → tier + extra rows; total reflects participants', async () => {
  const rule = agentsRule({ priceModel: 'tiered_group', fixedPriceMinor: null, perAdditionalParticipantMinor: 12000n,
    tiers: [{ uptoParticipants: 10, totalPriceMinor: 190000n, sortOrder: 0 }] });
  const m = await resolveAgentPricing(mockPrisma({ rules: [rule] }), { productVariantId: 'v1', participants: 12 });
  assert.deepEqual(m.rows, [
    { kind: 'tier', labelHe: 'עד 10 משתתפים', amountMinor: 190000 },
    { kind: 'perExtra', labelHe: 'כל משתתף נוסף', amountMinor: 12000 },
  ]);
  // 12 in 1 group: base 190000 + 2×12000 = 214000 (VAT-included gross).
  assert.equal(m.totalMinor, 214000);
});

test('per-participant Agents card → per-participant row; total = price × participants', async () => {
  const rule = agentsRule({ priceModel: 'per_head', fixedPriceMinor: null, adultPriceMinor: 15000n, childPriceMinor: 15000n });
  const m = await resolveAgentPricing(mockPrisma({ rules: [rule] }), { productVariantId: 'v1', participants: 10 });
  assert.deepEqual(m.rows, [{ kind: 'perParticipant', labelHe: 'מחיר למשתתף', amountMinor: 15000 }]);
  assert.equal(m.totalMinor, 150000);
});

test('incomplete participant count → structure only, no total', async () => {
  const m = await resolveAgentPricing(mockPrisma({ rules: [agentsRule()] }), { productVariantId: 'v1', participants: null });
  assert.equal(m.available, true);
  assert.equal(m.totalMinor, null);
  assert.equal(m.participantsKnown, false);
});

test('Saturday → separate per-group surcharge row + folded into the total', async () => {
  const systemAddon = { id: 'ad_sab', systemKey: 'sabbath_holiday', active: true, defaultPriceMinor: 25000n, vatMode: 'included', vatRate: 18 };
  const m = await resolveAgentPricing(
    mockPrisma({
      rules: [agentsRule()],
      systemAddon,
      sabbathWeekly: [{ active: true, dayOfWeek: 6, allDay: true, nameHe: 'שבת' }],
      addonCatalog: [{ id: 'ad_sab', nameHe: 'תוספת שבת', vatMode: 'included', vatRate: 18 }],
    }),
    { productVariantId: 'v1', participants: 8, tourDate: '2026-07-25', tourTime: '11:00' }, // Saturday
  );
  assert.equal(m.surcharges.length, 1);
  assert.deepEqual(m.surcharges[0], { kind: 'surcharge', labelHe: 'תוספת שבת', amountMinor: 25000, perGroup: true });
  assert.equal(m.totalMinor, 190000 + 25000); // base + surcharge
});

test('non-Saturday → no surcharge row', async () => {
  const systemAddon = { id: 'ad_sab', systemKey: 'sabbath_holiday', active: true, defaultPriceMinor: 25000n, vatMode: 'included', vatRate: 18 };
  const m = await resolveAgentPricing(
    mockPrisma({ rules: [agentsRule()], systemAddon, sabbathWeekly: [{ active: true, dayOfWeek: 6, allDay: true, nameHe: 'שבת' }], addonCatalog: [{ id: 'ad_sab', nameHe: 'תוספת שבת', vatMode: 'included', vatRate: 18 }] }),
    { productVariantId: 'v1', participants: 8, tourDate: '2026-07-21', tourTime: '11:00' }, // Tuesday
  );
  assert.equal(m.surcharges.length, 0);
});

test('no Agents card for the product → exact business fallback message', async () => {
  const m = await resolveAgentPricing(mockPrisma({ rules: [] }), { productVariantId: 'v1', participants: 8 });
  assert.equal(m.available, false);
  assert.equal(m.reason, 'no_agents_card');
  assert.equal(m.messageHe, AGENT_PRICE_FALLBACK_HE);
});

test('invalid Agents card config → safe fallback (invalid_config, not no_agents_card)', async () => {
  const bad = agentsRule({ priceModel: 'tiered_group', fixedPriceMinor: null, tiers: [] });
  const m = await resolveAgentPricing(mockPrisma({ rules: [bad] }), { productVariantId: 'v1', participants: 8 });
  assert.equal(m.available, false);
  assert.equal(m.reason, 'invalid_config');
  assert.equal(m.messageHe, AGENT_PRICE_FALLBACK_HE);
});

test('no variant → fallback', async () => {
  const m = await resolveAgentPricing(mockPrisma(), { productVariantId: null, participants: 8 });
  assert.equal(m.available, false);
  assert.equal(m.messageHe, AGENT_PRICE_FALLBACK_HE);
});

test('a product newly linked to Agents (data only) resolves with no code change', async () => {
  // Same resolver, different product id — nothing product-specific in the code.
  const rule = agentsRule({ productId: 'p_new', productVariantId: 'v_new' });
  const m = await resolveAgentPricing(
    mockPrisma({ variant: { id: 'v_new', productId: 'p_new' }, rules: [rule] }),
    { productVariantId: 'v_new', participants: 5 },
  );
  assert.equal(m.available, true);
  assert.equal(m.totalMinor, 190000);
});
