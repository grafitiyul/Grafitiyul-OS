import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ilsToMinor,
  autoAmountMinor,
  buildEntryLines,
  lineFinalMinor,
  entryTotals,
  sumTotals,
} from './engine.js';

// ── ilsToMinor (Decimal-shekels boundary) ────────────────────────────────────

test('ilsToMinor converts decimal shekels to integer agorot', () => {
  assert.equal(ilsToMinor(150), 15000);
  assert.equal(ilsToMinor('49.9'), 4990);
  assert.equal(ilsToMinor(0), 0);
  assert.equal(ilsToMinor(null), null);
  assert.equal(ilsToMinor('garbage'), null);
});

// ── auto rules ───────────────────────────────────────────────────────────────

test('base: guiding roles get the variant base pay; assistants get null (no rate source)', () => {
  const c = { autoRule: 'base' };
  assert.equal(autoAmountMinor(c, { role: 'lead_guide', baseGuidePaymentMinor: 42000 }), 42000);
  assert.equal(autoAmountMinor(c, { role: 'guide', baseGuidePaymentMinor: 42000n }), 42000);
  assert.equal(autoAmountMinor(c, { role: 'workshop_assistant', baseGuidePaymentMinor: 42000 }), null);
});

test('weekend_holiday: config amount only when the date is in a שבת/חג window', () => {
  const c = { autoRule: 'weekend_holiday', config: { amountMinor: 5000 } };
  assert.equal(autoAmountMinor(c, { isWeekendHoliday: true }), 5000);
  assert.equal(autoAmountMinor(c, { isWeekendHoliday: false }), 0);
  assert.equal(autoAmountMinor({ autoRule: 'weekend_holiday', config: {} }, { isWeekendHoliday: true }), 0);
});

test('participant_bonus: per-extra above threshold; unconfigured → 0', () => {
  const c = { autoRule: 'participant_bonus', config: { fromParticipants: 30, perExtraMinor: 500 } };
  assert.equal(autoAmountMinor(c, { participants: 36 }), 3000);
  assert.equal(autoAmountMinor(c, { participants: 30 }), 0);
  assert.equal(autoAmountMinor(c, { participants: 12 }), 0);
  const unconfigured = { autoRule: 'participant_bonus', config: {} };
  assert.equal(autoAmountMinor(unconfigured, { participants: 100 }), 0);
});

test('seniority comes from the profile decimal-shekels field', () => {
  const c = { autoRule: 'seniority' };
  assert.equal(autoAmountMinor(c, { seniorityIls: '25.5' }), 2550);
  assert.equal(autoAmountMinor(c, {}), 0);
});

test('travel precedence: variant value wins even when 0; else guide allowance', () => {
  const c = { autoRule: 'travel' };
  assert.equal(autoAmountMinor(c, { variantTravelMinor: 3000, travelAllowanceIls: 99 }), 3000);
  assert.equal(autoAmountMinor(c, { variantTravelMinor: 0, travelAllowanceIls: 99 }), 0);
  assert.equal(autoAmountMinor(c, { variantTravelMinor: null, travelAllowanceIls: 45 }), 4500);
  assert.equal(autoAmountMinor(c, {}), 0);
});

test('general_quantity: unit price × generic units (not necessarily hours)', () => {
  const c = { autoRule: 'general_quantity' };
  assert.equal(autoAmountMinor(c, { unitPriceMinor: 6000, quantity: 2.5 }), 15000);
});

// ── buildEntryLines ──────────────────────────────────────────────────────────

const CATALOG = [
  { id: 'payc_base', nameHe: 'תשלום בסיס', kind: 'auto', autoRule: 'base', sign: 1, vatMode: 'net', scope: 'tour', active: true, sortOrder: 10 },
  { id: 'payc_general', nameHe: 'תשלום פעילות', kind: 'auto', autoRule: 'general_quantity', sign: 1, vatMode: 'net', scope: 'general', active: true, sortOrder: 15 },
  { id: 'payc_travel', nameHe: 'נסיעות', kind: 'auto', autoRule: 'travel', sign: 1, vatMode: 'none', scope: 'tour', active: true, sortOrder: 50 },
  { id: 'payc_addition', nameHe: 'תוספת', kind: 'manual', sign: 1, vatMode: 'net', scope: 'all', active: true, sortOrder: 60 },
  { id: 'payc_deduction', nameHe: 'ניכוי', kind: 'manual', sign: -1, vatMode: 'net', scope: 'all', active: true, sortOrder: 70 },
  { id: 'payc_dead', nameHe: 'לא פעיל', kind: 'manual', sign: 1, vatMode: 'net', scope: 'all', active: false, sortOrder: 90 },
];

test('tour entry lines: tour-scope + all-scope components, inactive excluded, manual rows exist at zero', () => {
  const lines = buildEntryLines({
    source: 'tour',
    components: CATALOG,
    inputs: { role: 'guide', baseGuidePaymentMinor: 40000, variantTravelMinor: 2500 },
  });
  assert.deepEqual(lines.map((l) => l.componentId), ['payc_base', 'payc_travel', 'payc_addition', 'payc_deduction']);
  assert.equal(lines[0].calculatedMinor, 40000);
  assert.equal(lines[1].calculatedMinor, 2500);
  // Manual rows: no calculation, present for quick office entry.
  assert.equal(lines[2].calculatedMinor, null);
  assert.equal(lines[3].sign, -1);
});

test('general entry lines: general-scope quantity line carries unit price + units', () => {
  const lines = buildEntryLines({
    source: 'general',
    components: CATALOG,
    inputs: { unitPriceMinor: 6000, quantity: 3 },
  });
  assert.deepEqual(lines.map((l) => l.componentId), ['payc_general', 'payc_addition', 'payc_deduction']);
  assert.equal(lines[0].calculatedMinor, 18000);
  assert.equal(lines[0].quantity, 3);
  assert.equal(lines[0].unitPriceMinor, 6000);
});

// ── final / override semantics ───────────────────────────────────────────────

test('final = override ?? calculated ?? 0 — the calculation is never replaced', () => {
  assert.equal(lineFinalMinor({ calculatedMinor: 40000, overrideMinor: null }), 40000);
  assert.equal(lineFinalMinor({ calculatedMinor: 40000, overrideMinor: 35000 }), 35000);
  assert.equal(lineFinalMinor({ calculatedMinor: 40000, overrideMinor: 0 }), 0);
  assert.equal(lineFinalMinor({ calculatedMinor: null, overrideMinor: null }), 0);
});

// ── VAT totals ───────────────────────────────────────────────────────────────

test('exempt guide: flat total, VAT never computed', () => {
  const lines = [
    { sign: 1, vatMode: 'net', calculatedMinor: 40000 },
    { sign: -1, vatMode: 'net', calculatedMinor: null, overrideMinor: 5000 },
  ];
  const t = entryTotals(lines, { vatStatus: 'exempt' });
  assert.deepEqual(t, { vatStatus: 'exempt', totalMinor: 35000, netMinor: 35000, vatMinor: 0 });
});

test('vat_18 guide: net lines gain VAT, gross lines split, none lines pass through', () => {
  const lines = [
    { sign: 1, vatMode: 'net', calculatedMinor: 10000 },   // +18% → 11800
    { sign: 1, vatMode: 'gross', calculatedMinor: 11800 }, // already incl. → net 10000 vat 1800
    { sign: 1, vatMode: 'none', calculatedMinor: 3000 },   // no VAT ever
  ];
  const t = entryTotals(lines, { vatStatus: 'vat_18', vatRate: 18 });
  assert.equal(t.netMinor, 23000);
  assert.equal(t.vatMinor, 3600);
  assert.equal(t.totalMinor, 26600);
});

test('vat_18 deduction reduces net and VAT symmetrically', () => {
  const lines = [
    { sign: 1, vatMode: 'net', calculatedMinor: 10000 },
    { sign: -1, vatMode: 'net', overrideMinor: 2000 },
  ];
  const t = entryTotals(lines, { vatStatus: 'vat_18', vatRate: 18 });
  assert.equal(t.netMinor, 8000);
  assert.equal(t.vatMinor, 1440);
  assert.equal(t.totalMinor, 9440);
});

test('sumTotals blends gross totals across mixed VAT statuses (admin totals)', () => {
  assert.equal(sumTotals([{ totalMinor: 42000 }, { totalMinor: 26600 }, null]), 68600);
});
