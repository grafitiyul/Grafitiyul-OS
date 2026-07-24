// Agent pricing resolver — integration over a mock prisma. New semantic
// contract: applied rows only in exact mode, structured VAT totals, groupCount
// from "מספר מדריכים", localized fallback key, structural mode with missing[].

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAgentPricing, AGENT_PRICE_FALLBACK_HE } from './agentPricing.js';

function mockPrisma({ variant = { id: 'v1', productId: 'p1' }, rules = [], sabbathWeekly = [], holidays = [], systemAddon = null, addonCatalog = [] } = {}) {
  return {
    productVariant: { findUnique: async () => variant },
    priceList: {
      findFirst: async () => ({ id: 'pl', defaultVatMode: 'included', defaultVatRate: 18 }),
      findUnique: async () => ({ id: 'pl', defaultVatMode: 'included', defaultVatRate: 18, rules }),
    },
    pricingSegment: { findFirst: async () => ({ id: 'seg_agents' }) },
    addon: { findFirst: async () => systemAddon, findMany: async () => addonCatalog },
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

const LADDER_RULE = () => agentsRule({
  priceModel: 'tiered_group', fixedPriceMinor: null, perAdditionalParticipantMinor: 12000n,
  tiers: [
    { uptoParticipants: 5, totalPriceMinor: 90000n, sortOrder: 0 },
    { uptoParticipants: 10, totalPriceMinor: 165000n, sortOrder: 1 },
  ],
});

const SYS = { id: 'ad_sab', systemKey: 'sabbath_holiday', active: true, defaultPriceMinor: 25000n, vatMode: 'included', vatRate: 18 };
const SAT_CFG = {
  systemAddon: SYS,
  sabbathWeekly: [{ active: true, dayOfWeek: 6, allDay: true, nameHe: 'שבת' }],
  addonCatalog: [{ id: 'ad_sab', nameHe: 'תוספת שבת/חג', vatMode: 'included', vatRate: 18 }],
};

// ── exact mode: applied rows + VAT breakdown ────────────────────────────────

test('20 participants: exact mode shows applied tier + extra only (no lower tier)', async () => {
  const m = await resolveAgentPricing(mockPrisma({ rules: [LADDER_RULE()] }), { productVariantId: 'v1', participants: 20, groups: 1 });
  assert.equal(m.mode, 'exact');
  assert.deepEqual(m.rows.map((r) => [r.type, r.threshold ?? null, r.quantity]), [
    ['tier_up_to', 10, 1],
    ['extra_participant', null, 10],
  ]);
});

test('3 participants: only the small applied tier; no next tier, no extra row', async () => {
  const m = await resolveAgentPricing(mockPrisma({ rules: [LADDER_RULE()] }), { productVariantId: 'v1', participants: 3, groups: 1 });
  assert.deepEqual(m.rows.map((r) => [r.type, r.threshold]), [['tier_up_to', 5]]);
});

test('20 participants / 2 guides → groups=2 distribution (10+10, no extras)', async () => {
  const m = await resolveAgentPricing(mockPrisma({ rules: [LADDER_RULE()] }), { productVariantId: 'v1', participants: 20, groups: 2 });
  assert.deepEqual(m.rows.map((r) => [r.type, r.threshold ?? null, r.quantity, r.totalMinor]), [
    ['tier_up_to', 10, 2, 330000],
  ]);
  assert.equal(m.totals.grossMinor, 330000);
});

test('VAT included: subtotal + VAT reconcile exactly to the total', async () => {
  const m = await resolveAgentPricing(mockPrisma({ rules: [agentsRule()] }), { productVariantId: 'v1', participants: 8, groups: 1 });
  assert.equal(m.totals.vatMode, 'included');
  assert.equal(m.totals.vatRate, 18);
  assert.equal(m.totals.grossMinor, 190000);
  assert.equal(m.totals.netMinor + m.totals.vatMinor, m.totals.grossMinor);
  assert.equal(m.totals.netMinor, Math.round(190000 / 1.18));
});

test('VAT excluded: VAT added on top; net + vat === gross', async () => {
  const m = await resolveAgentPricing(
    mockPrisma({ rules: [agentsRule({ vatMode: 'excluded', vatRate: 18 })] }),
    { productVariantId: 'v1', participants: 8, groups: 1 },
  );
  assert.equal(m.totals.vatMode, 'excluded');
  assert.equal(m.totals.netMinor, 190000);
  assert.equal(m.totals.vatMinor, Math.round(190000 * 0.18));
  assert.equal(m.totals.netMinor + m.totals.vatMinor, m.totals.grossMinor);
});

test('VAT exempt: vat = 0, net === gross, mode exposed for the exempt state', async () => {
  const m = await resolveAgentPricing(
    mockPrisma({ rules: [agentsRule({ vatMode: 'exempt', vatRate: 0 })] }),
    { productVariantId: 'v1', participants: 8, groups: 1 },
  );
  assert.equal(m.totals.vatMode, 'exempt');
  assert.equal(m.totals.vatMinor, 0);
  assert.equal(m.totals.netMinor, m.totals.grossMinor);
});

// ── Saturday / holiday semantics + guide multiplication ─────────────────────

test('Saturday × 2 guides: saturday_surcharge row with quantity 2, folded into totals', async () => {
  const m = await resolveAgentPricing(
    mockPrisma({ rules: [agentsRule()], ...SAT_CFG }),
    { productVariantId: 'v1', participants: 8, groups: 2, tourDate: '2026-07-25', tourTime: '11:00' },
  );
  const s = m.rows.find((r) => r.type === 'saturday_surcharge');
  assert.deepEqual([s.quantity, s.unitAmountMinor, s.totalMinor], [2, 25000, 50000]);
  // fixed 190000 × 2 groups + 50000 surcharge
  assert.equal(m.totals.grossMinor, 380000 + 50000);
  assert.equal(m.totals.netMinor + m.totals.vatMinor, m.totals.grossMinor);
});

test('configured holiday (chag) → holiday_surcharge semantic type', async () => {
  const m = await resolveAgentPricing(
    mockPrisma({
      rules: [agentsRule()], systemAddon: SYS,
      holidays: [{ active: true, status: 'approved', date: new Date('2026-07-28T00:00:00Z'), allDay: true, type: 'chag', nameHe: 'חג' }],
      addonCatalog: SAT_CFG.addonCatalog,
    }),
    { productVariantId: 'v1', participants: 8, groups: 1, tourDate: '2026-07-28', tourTime: '11:00' },
  );
  assert.equal(m.rows.some((r) => r.type === 'holiday_surcharge'), true);
});

test('plain weekday: no surcharge rows', async () => {
  const m = await resolveAgentPricing(
    mockPrisma({ rules: [agentsRule()], ...SAT_CFG }),
    { productVariantId: 'v1', participants: 8, groups: 1, tourDate: '2026-07-21', tourTime: '11:00' },
  );
  assert.equal(m.rows.some((r) => r.type.endsWith('surcharge')), false);
});

// ── structural mode + fallbacks ─────────────────────────────────────────────

test('no participants → structural mode, full structure, missing=[participants], no totals', async () => {
  const m = await resolveAgentPricing(mockPrisma({ rules: [LADDER_RULE()] }), { productVariantId: 'v1', participants: null, groups: 1 });
  assert.equal(m.mode, 'structural');
  assert.equal(m.totals, null);
  assert.deepEqual(m.missing, ['participants']);
  assert.equal(m.rows.filter((r) => r.type === 'tier_up_to').length, 2); // full structure
});

test('no Agents card → localized fallback key + exact Hebrew message', async () => {
  const m = await resolveAgentPricing(mockPrisma({ rules: [] }), { productVariantId: 'v1', participants: 8, groups: 1 });
  assert.equal(m.available, false);
  assert.equal(m.fallbackKey, 'agent_price_list');
  assert.equal(m.messageHe, AGENT_PRICE_FALLBACK_HE);
});

test('invalid Agents card config → safe fallback with fallbackKey', async () => {
  const bad = agentsRule({ priceModel: 'tiered_group', fixedPriceMinor: null, tiers: [] });
  const m = await resolveAgentPricing(mockPrisma({ rules: [bad] }), { productVariantId: 'v1', participants: 8, groups: 1 });
  assert.equal(m.available, false);
  assert.equal(m.reason, 'invalid_config');
  assert.equal(m.fallbackKey, 'agent_price_list');
});

test('independent cards: different groups values produce independent results (no leakage)', async () => {
  const prisma = mockPrisma({ rules: [agentsRule()] });
  const [a, b] = await Promise.all([
    resolveAgentPricing(prisma, { productVariantId: 'v1', participants: 8, groups: 1 }),
    resolveAgentPricing(prisma, { productVariantId: 'v1', participants: 8, groups: 3 }),
  ]);
  assert.equal(a.totals.grossMinor, 190000);
  assert.equal(b.totals.grossMinor, 570000);
});

test('a product newly linked to Agents resolves from data alone', async () => {
  const rule = agentsRule({ productId: 'p_new', productVariantId: 'v_new' });
  const m = await resolveAgentPricing(
    mockPrisma({ variant: { id: 'v_new', productId: 'p_new' }, rules: [rule] }),
    { productVariantId: 'v_new', participants: 5, groups: 1 },
  );
  assert.equal(m.available, true);
  assert.equal(m.totals.grossMinor, 190000);
});
