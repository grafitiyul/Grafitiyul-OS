// Structured semantic pricing display — pure, no DB. Covers the applied-row
// builder (only rows that participated in the calculation), the structural
// preview, and semantic surcharge typing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { describeApplied, describeStructure, describeSurcharges } from './pricingDisplay.js';
import { calculate } from './engine.js';

const runRule = (rule, counts) =>
  calculate({
    priceList: { id: 'pl', nameHe: 'x', currency: 'ILS', isDefault: true, defaultVatMode: 'excluded', defaultVatRate: 0, rules: [rule] },
    activityType: { id: 'at1' },
    context: { activityTypeId: 'at1' },
    counts,
  });

const LADDER = {
  id: 'r1', active: true, priceModel: 'tiered_group', priority: 0,
  perAdditionalParticipantMinor: 12000n,
  tiers: [
    { uptoParticipants: 5, totalPriceMinor: 90000n, sortOrder: 0 },
    { uptoParticipants: 10, totalPriceMinor: 165000n, sortOrder: 1 },
  ],
};

// ── applied rows: ONLY what the calculation used ────────────────────────────

test('20 participants: unused lower tier omitted; applied tier + extra row only', () => {
  const r = runRule(LADDER, { participantCount: 20, groupCount: 1 });
  const rows = describeApplied(LADDER, r);
  assert.deepEqual(rows, [
    { type: 'tier_up_to', threshold: 10, scope: 'per_group', quantity: 1, unitAmountMinor: 165000, totalMinor: 165000 },
    { type: 'extra_participant', scope: 'per_participant', quantity: 10, unitAmountMinor: 12000, totalMinor: 120000 },
  ]);
  // NO "up to 5" row, and the totals reconcile with the engine amount.
  assert.equal(165000 + 120000, r.netMinor);
});

test('3 participants: only the applied small tier; no next tier, no extra row', () => {
  const r = runRule(LADDER, { participantCount: 3, groupCount: 1 });
  const rows = describeApplied(LADDER, r);
  assert.deepEqual(rows, [
    { type: 'tier_up_to', threshold: 5, scope: 'per_group', quantity: 1, unitAmountMinor: 90000, totalMinor: 90000 },
  ]);
});

test('groups > 1: applied tier row carries quantity = groups', () => {
  const r = runRule(LADDER, { participantCount: 16, groupCount: 2 }); // 8+8 → tier 10 each
  const rows = describeApplied(LADDER, r);
  assert.deepEqual(rows, [
    { type: 'tier_up_to', threshold: 10, scope: 'per_group', quantity: 2, unitAmountMinor: 165000, totalMinor: 330000 },
  ]);
});

test('fixed: one applied fixed row (quantity = groups)', () => {
  const rule = { id: 'r', active: true, priceModel: 'fixed', fixedPriceMinor: 130000n, priority: 0 };
  const rows = describeApplied(rule, runRule(rule, { participantCount: 4, groupCount: 1 }));
  assert.deepEqual(rows, [{ type: 'fixed_price', scope: 'per_group', quantity: 1, unitAmountMinor: 130000, totalMinor: 130000 }]);
});

test('per_head: applied per-participant row with quantity = participants', () => {
  const rule = { id: 'r', active: true, priceModel: 'per_head', adultPriceMinor: 12000n, childPriceMinor: 12000n, priority: 0 };
  const rows = describeApplied(rule, runRule(rule, { participantCount: 10, adultCount: 10 }));
  assert.deepEqual(rows, [{ type: 'per_participant', scope: 'per_participant', quantity: 10, unitAmountMinor: 12000, totalMinor: 120000 }]);
});

test('mixed-tier group split (no faithful decomposition) → null (caller falls back)', () => {
  // 13p/2g → 7+6 land on different tiers → breakdown null → applied null.
  const two = { id: 'r', active: true, priceModel: 'tiered_group', priority: 0, perAdditionalParticipantMinor: 10000n,
    tiers: [{ uptoParticipants: 6, totalPriceMinor: 90000n, sortOrder: 0 }, { uptoParticipants: 12, totalPriceMinor: 150000n, sortOrder: 1 }] };
  assert.equal(describeApplied(two, runRule(two, { participantCount: 13, groupCount: 2 })), null);
});

// ── structural preview (no context): full structure, quantity null ──────────

test('structural: all tiers + extra row, quantity null (nothing multiplied)', () => {
  const s = describeStructure(LADDER);
  assert.deepEqual(s.rows.map((r) => [r.type, r.threshold ?? null, r.unitAmountMinor, r.quantity]), [
    ['tier_up_to', 5, 90000, null],
    ['tier_up_to', 10, 165000, null],
    ['extra_participant', null, 12000, null],
  ]);
});

test('structural: unknown model degrades safely', () => {
  const s = describeStructure({ priceModel: 'future_model' });
  assert.deepEqual(s.rows, []);
  assert.equal(s.degraded, true);
});

// ── semantic surcharges ─────────────────────────────────────────────────────

test('system שבת addon on Saturday → saturday_surcharge; on chag → holiday_surcharge', () => {
  const line = { refId: 'sys1', label: 'תוספת שבת/חג', unitPriceMinor: 25000, quantity: 2 };
  const sat = describeSurcharges([line], { systemAddonId: 'sys1', sabbathType: 'shabbat' });
  assert.deepEqual(sat, [{ type: 'saturday_surcharge', scope: 'per_group', quantity: 2, unitAmountMinor: 25000, totalMinor: 50000 }]);
  const hol = describeSurcharges([line], { systemAddonId: 'sys1', sabbathType: 'chag' });
  assert.equal(hol[0].type, 'holiday_surcharge');
  const erev = describeSurcharges([line], { systemAddonId: 'sys1', sabbathType: 'erev_chag' });
  assert.equal(erev[0].type, 'holiday_surcharge');
});

test('business (non-system) auto addon keeps its catalog label with generic type', () => {
  const rows = describeSurcharges([{ refId: 'a9', label: 'תוספת שישי', unitPriceMinor: 15000, quantity: 1 }], { systemAddonId: 'sys1', sabbathType: null });
  assert.deepEqual(rows, [{ type: 'surcharge', scope: 'per_group', quantity: 1, unitAmountMinor: 15000, totalMinor: 15000, labelHe: 'תוספת שישי' }]);
});
