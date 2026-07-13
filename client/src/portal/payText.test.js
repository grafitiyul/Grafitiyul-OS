import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitingLabel, formatQuantity, lineCalcLabel, lineDisplayName } from './payText.js';
import { formatMinor } from '../lib/money.js';

// The waiting summary card shows an ACTIVITY COUNT, never an unapproved
// amount — with correct Hebrew singular/plural.

test('waitingLabel: zero / singular / plural Hebrew forms', () => {
  assert.equal(waitingLabel(0), 'אין פעילויות הממתינות לאישורך');
  assert.equal(waitingLabel(1), 'פעילות אחת ממתינה לאישורך');
  assert.equal(waitingLabel(3), '3 פעילויות ממתינות לאישורך');
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
});

test('lineDisplayName: tour deduction ניכוי is shown as קיזוז (display only)', () => {
  assert.equal(lineDisplayName('ניכוי', 'tour_event'), 'קיזוז');
  // Only for tours, only for that exact label; everything else is untouched.
  assert.equal(lineDisplayName('ניכוי', 'general'), 'ניכוי');
  assert.equal(lineDisplayName('תשלום בסיס', 'tour_event'), 'תשלום בסיס');
  assert.equal(lineDisplayName('ניכוי נסיעות', 'tour_event'), 'ניכוי נסיעות');
});
