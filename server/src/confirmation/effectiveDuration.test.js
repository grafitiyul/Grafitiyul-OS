// Deal-effective duration tests — the approved precedence (decision D2):
//   1. Deal.durationHours (operator-confirmed override)
//   2. open-tour slot override (OpenTourTemplate.durationHoursOverride)
//   3. ProductVariant.durationHours
//   4. platform default
// The resolver lives in tours/tourTime.js (the duration SSOT); the tests live
// here because the Deal override is a confirmation-module concern.
// Run with `npm test` (node:test).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  effectiveDurationHours,
  tourDurationHours,
  DEFAULT_DURATION_HOURS,
} from '../tours/tourTime.js';

const tour = {
  openTourTemplate: { durationHoursOverride: 4 },
  productVariant: { durationHours: 3 },
};

test('deal override beats the whole operational chain', () => {
  assert.equal(effectiveDurationHours({ durationHours: 2.5 }, tour), 2.5);
});

test('no deal override → canonical tour rule (slot override first)', () => {
  assert.equal(effectiveDurationHours({ durationHours: null }, tour), 4);
  assert.equal(effectiveDurationHours(null, tour), 4);
});

test('variant duration when no overrides anywhere', () => {
  assert.equal(
    effectiveDurationHours({}, { productVariant: { durationHours: 3 } }),
    3,
  );
});

test('platform default as the last resort', () => {
  assert.equal(effectiveDurationHours({}, {}), DEFAULT_DURATION_HOURS);
  assert.equal(effectiveDurationHours(null, null), DEFAULT_DURATION_HOURS);
});

test('invalid deal overrides are ignored, never propagated', () => {
  for (const bad of [0, -2, NaN, 'abc', '']) {
    assert.equal(effectiveDurationHours({ durationHours: bad }, tour), 4, `override=${bad}`);
  }
});

test('delegates to the SAME canonical rule (no drift with tourDurationHours)', () => {
  assert.equal(effectiveDurationHours({}, tour), tourDurationHours(tour));
});
