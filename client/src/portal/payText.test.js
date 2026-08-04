import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitingLabel, formatQuantity, lineCalcLabel, lineDisplayName } from './payText.js';
import { formatMinor } from '../lib/money.js';
import { portalStrings } from './i18n.js';

// The wording lives in the ONE portal registry; this module holds only the
// RULES. Tests therefore read the same registry the app does — a missing or
// renamed key fails here rather than shipping a blank label to a guide.
const HE = portalStrings('he').pay;
const EN = portalStrings('en').pay;

// The waiting summary card shows an ACTIVITY COUNT, never an unapproved
// amount — with correct singular/plural in BOTH languages.

test('waitingLabel: zero / singular / plural Hebrew forms', () => {
  assert.equal(waitingLabel(0, HE), 'אין פעילויות הממתינות לאישורך');
  assert.equal(waitingLabel(1, HE), 'פעילות אחת ממתינה לאישורך');
  assert.equal(waitingLabel(3, HE), '3 פעילויות ממתינות לאישורך');
});

test('waitingLabel: zero / singular / plural English forms', () => {
  assert.equal(waitingLabel(0, EN), 'Nothing is waiting for your approval');
  assert.equal(waitingLabel(1, EN), '1 activity is waiting for your approval');
  assert.equal(waitingLabel(3, EN), '3 activities are waiting for your approval');
});

test('formatQuantity: decimals kept, trailing zeros dropped', () => {
  assert.equal(formatQuantity(1.5), '1.5');
  assert.equal(formatQuantity(2), '2');
  assert.equal(formatQuantity(1.25), '1.25');
  assert.equal(formatQuantity('1.50'), '1.5');
  assert.equal(formatQuantity(3.0), '3');
});

test('lineCalcLabel: shows rate × quantity for an hourly-style line', () => {
  // ₪40 (4000 minor) × 1.5 = ₪60 (6000 minor). The money is formatted through
  // the canonical formatMinor (he-IL) — the label is "<rate> × <qty>".
  assert.equal(
    lineCalcLabel({ unitPriceMinor: 4000, quantity: 1.5, amountMinor: 6000 }),
    `${formatMinor(4000)} × 1.5`,
  );
  // Whole quantity renders without decimals.
  assert.equal(
    lineCalcLabel({ unitPriceMinor: 5000, quantity: 2, amountMinor: 10000 }),
    `${formatMinor(5000)} × 2`,
  );
});

test('lineCalcLabel: null for direct amounts (no rate/quantity) — tours unaffected', () => {
  assert.equal(lineCalcLabel({ unitPriceMinor: null, quantity: null, amountMinor: 35000 }), null);
  assert.equal(lineCalcLabel({ amountMinor: 35000 }), null);
});

test('lineCalcLabel: null when an override broke the rate × quantity relationship', () => {
  // Calculated 40 × 1.5 = 60, but the office overrode the amount to ₪75 — the
  // breakdown no longer reconciles, so we do NOT show a misleading equation.
  assert.equal(lineCalcLabel({ unitPriceMinor: 4000, quantity: 1.5, amountMinor: 7500 }), null);
  // ...even with unit labels configured.
  assert.equal(
    lineCalcLabel({ unitPriceMinor: 4000, quantity: 1.5, amountMinor: 7500, unitLabelSingular: 'שעה', unitLabelPlural: 'שעות' }),
    null,
  );
});

test('lineCalcLabel: singular noun for quantity = 1', () => {
  assert.equal(
    lineCalcLabel({ unitPriceMinor: 4000, quantity: 1, amountMinor: 4000, unitLabelSingular: 'שעה', unitLabelPlural: 'שעות' }),
    `${formatMinor(4000)} לשעה × 1 שעה`,
  );
});

test('lineCalcLabel: plural noun for quantity ≠ 1 (decimal)', () => {
  assert.equal(
    lineCalcLabel({ unitPriceMinor: 4000, quantity: 1.5, amountMinor: 6000, unitLabelSingular: 'שעה', unitLabelPlural: 'שעות' }),
    `${formatMinor(4000)} לשעה × 1.5 שעות`,
  );
});

test('lineCalcLabel: "יום / ימים" and clean whole quantities', () => {
  assert.equal(
    lineCalcLabel({ unitPriceMinor: 25000, quantity: 2, amountMinor: 50000, unitLabelSingular: 'יום', unitLabelPlural: 'ימים' }),
    `${formatMinor(25000)} ליום × 2 ימים`,
  );
});

test('lineCalcLabel: "יחידה / יחידות" equipment example', () => {
  assert.equal(
    lineCalcLabel({ unitPriceMinor: 5000, quantity: 3, amountMinor: 15000, unitLabelSingular: 'יחידה', unitLabelPlural: 'יחידות' }),
    `${formatMinor(5000)} ליחידה × 3 יחידות`,
  );
  // Singular for exactly one unit.
  assert.equal(
    lineCalcLabel({ unitPriceMinor: 5000, quantity: 1, amountMinor: 5000, unitLabelSingular: 'יחידה', unitLabelPlural: 'יחידות' }),
    `${formatMinor(5000)} ליחידה × 1 יחידה`,
  );
});

test('lineCalcLabel: empty unit labels fall back to the unitless breakdown', () => {
  assert.equal(
    lineCalcLabel({ unitPriceMinor: 4000, quantity: 1.5, amountMinor: 6000, unitLabelSingular: null, unitLabelPlural: null }),
    `${formatMinor(4000)} × 1.5`,
  );
  assert.equal(
    lineCalcLabel({ unitPriceMinor: 4000, quantity: 1.5, amountMinor: 6000, unitLabelSingular: '', unitLabelPlural: '' }),
    `${formatMinor(4000)} × 1.5`,
  );
});

test('lineDisplayName: tour deduction ניכוי is shown as קיזוז (display only)', () => {
  assert.equal(lineDisplayName('ניכוי', 'tour_event', HE), 'קיזוז');
  // Only for tours, only for that exact label; everything else is untouched.
  assert.equal(lineDisplayName('ניכוי', 'general', HE), 'ניכוי');
  assert.equal(lineDisplayName('תשלום בסיס', 'tour_event', HE), 'תשלום בסיס');
  assert.equal(lineDisplayName('ניכוי נסיעות', 'tour_event', HE), 'ניכוי נסיעות');
});

// Payroll component names are single-language DATA (PayrollComponent.nameHe has
// no English twin anywhere in GOS). An English reader therefore sees the stored
// name — the relabel rule still applies because it is defined over that stored
// Hebrew name, and nothing is machine-translated.
test('lineDisplayName: the stored payroll name is never translated for an English reader', () => {
  assert.equal(lineDisplayName('ניכוי', 'tour_event', EN), 'קיזוז');
  assert.equal(lineDisplayName('תשלום בסיס', 'tour_event', EN), 'תשלום בסיס');
});

// The Hebrew rate preposition ("₪40 לשעה") only works glued to a Hebrew noun.
// For an English reader the bare multiplier is used with the stored noun —
// honest about the missing data instead of inventing an English unit.
test('lineCalcLabel: English reader gets the bare multiplier, stored noun intact', () => {
  assert.equal(
    lineCalcLabel(
      { unitPriceMinor: 4000, quantity: 1.5, amountMinor: 6000, unitLabelSingular: 'שעה', unitLabelPlural: 'שעות' },
      'en',
    ),
    `${formatMinor(4000)} × 1.5 שעות`,
  );
});
