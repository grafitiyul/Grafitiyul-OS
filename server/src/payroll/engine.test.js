import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ilsToMinor,
  autoAmountMinor,
  buildEntryLines,
  lineFinalMinor,
  entryTotals,
  sumTotals,
  deriveOfficeState,
  entryApprovable,
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

// ── weekend/holiday = 50% of the entry's calculated base ────────────────────
// Canonical rule: weekend_holiday_percent_of_base, multiplier 0.5, applied
// only when the existing שבת/חג detector qualified the tour. No fixed sum,
// no second calendar.

const WEEKEND = { autoRule: 'weekend_holiday_percent_of_base', config: { multiplier: 0.5 } };
const GUIDE_400 = { role: 'guide', baseGuidePaymentMinor: 40000 };

test('weekend rule 1 — normal weekday: base 400₪ → weekend line 0', () => {
  assert.equal(autoAmountMinor(WEEKEND, { ...GUIDE_400, isWeekendHoliday: false }), 0);
});

test('weekend rule 2 — שבת/חג: base 400₪ → weekend 200₪, subtotal before other components 600₪', () => {
  const base = autoAmountMinor({ autoRule: 'base' }, GUIDE_400);
  const weekend = autoAmountMinor(WEEKEND, { ...GUIDE_400, isWeekendHoliday: true });
  assert.equal(base, 40000);
  assert.equal(weekend, 20000);
  assert.equal(base + weekend, 60000); // 150% of base before bonuses/travel/etc.
});

test('weekend rule 3 — different base: 350₪ → weekend 175₪', () => {
  assert.equal(
    autoAmountMinor(WEEKEND, { role: 'lead_guide', baseGuidePaymentMinor: 35000, isWeekendHoliday: true }),
    17500,
  );
});

test('weekend rule 4 — override wins: calculated 200₪, override 250₪ → final 250₪', () => {
  const line = { calculatedMinor: 20000, overrideMinor: 25000 };
  assert.equal(lineFinalMinor(line), 25000);
});

test('weekend rule 5 — engine is pure: a stored calculation never changes when the base changes later', () => {
  // The stored line keeps the value calculated at its time; a fresh engine run
  // with today's (different) base yields a different number ONLY when someone
  // explicitly recalculates — nothing mutates the stored value by itself.
  const storedLine = { calculatedMinor: 20000, overrideMinor: null }; // from base 400₪
  const freshRun = autoAmountMinor(WEEKEND, { role: 'guide', baseGuidePaymentMinor: 50000, isWeekendHoliday: true });
  assert.equal(freshRun, 25000); // current rules would say 250₪…
  assert.equal(lineFinalMinor(storedLine), 20000); // …but the stored payroll stays 200₪
});

test('weekend rule 6 — workshop assistant with no base: no automatic 50% amount', () => {
  assert.equal(
    autoAmountMinor(WEEKEND, { role: 'workshop_assistant', baseGuidePaymentMinor: 40000, isWeekendHoliday: true }),
    null,
  );
});

test('weekend rule 7 — the detector stays the ONLY calendar: the engine reacts to the isWeekendHoliday flag alone', () => {
  // Date-like fields must have zero effect — the שבת/חג decision is made by
  // sabbathHolidayWindow (CRM settings) upstream and passed in as a boolean.
  const saturdayLooking = { ...GUIDE_400, isWeekendHoliday: false, date: '2026-07-11', weekday: 6 };
  assert.equal(autoAmountMinor(WEEKEND, saturdayLooking), 0);
  // Legacy catalog key maps to the SAME percent rule — a stale fixed-amount
  // config can never resurrect a configured sum.
  const legacy = { autoRule: 'weekend_holiday', config: { amountMinor: 99900 } };
  assert.equal(autoAmountMinor(legacy, { ...GUIDE_400, isWeekendHoliday: true }), 20000);
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

// ── selective office approval: derived state, single truth ──────────────────

test('deriveOfficeState: none → draft, some → partially_approved, all → office_approved', () => {
  const e = (officeStatus, state = 'active') => ({ officeStatus, state });
  assert.equal(deriveOfficeState([]), 'draft');
  assert.equal(deriveOfficeState([e('draft'), e('draft')]), 'draft');
  assert.equal(deriveOfficeState([e('approved'), e('draft')]), 'partially_approved');
  assert.equal(deriveOfficeState([e('approved'), e('approved')]), 'office_approved');
  // Cancelled/voided entries never affect the derivation.
  assert.equal(deriveOfficeState([e('approved'), e('draft', 'voided')]), 'office_approved');
  assert.equal(deriveOfficeState([e('draft', 'cancelled')]), 'draft');
});

test('entryApprovable: an all-zero entry is not silently approvable', () => {
  assert.equal(entryApprovable([{ calculatedMinor: 0 }, { calculatedMinor: null }]), false);
  assert.equal(entryApprovable([{ calculatedMinor: 0 }, { overrideMinor: 5000 }]), true);
  assert.equal(entryApprovable([]), false);
});
