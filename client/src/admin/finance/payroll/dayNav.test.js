import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shiftDay, DAY_NAV, CHEVRON_POINTS } from './dayNav.js';

// Regression for the reversed daily arrows: in the Hebrew RTL UI the
// RIGHT-pointing chevron must go to the PREVIOUS day and the LEFT-pointing
// chevron to the NEXT day — rendered from explicit SVG points, never from
// bidi-mirrored Unicode characters.

test('RTL semantics: right-pointing chevron = previous day, left-pointing = next day', () => {
  const prev = DAY_NAV.find((n) => n.key === 'prev');
  const next = DAY_NAV.find((n) => n.key === 'next');
  assert.equal(prev.points, 'right');
  assert.equal(prev.delta, -1);
  assert.equal(next.points, 'left');
  assert.equal(next.delta, 1);
  // First in DOM order = rightmost control in an RTL row → must be "prev".
  assert.equal(DAY_NAV[0].key, 'prev');
});

test('chevron glyphs are explicit SVG polylines (bidi-safe), pointing as named', () => {
  // x moves from 9 → 15 (rightward apex) for "right", 15 → 9 for "left".
  assert.equal(CHEVRON_POINTS.right, '9 6 15 12 9 18');
  assert.equal(CHEVRON_POINTS.left, '15 6 9 12 15 18');
});

test('shiftDay: simple previous/next day', () => {
  assert.equal(shiftDay('2026-07-12', -1), '2026-07-11');
  assert.equal(shiftDay('2026-07-12', 1), '2026-07-13');
});

test('shiftDay: month boundaries (incl. leap February)', () => {
  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDay('2026-07-31', 1), '2026-08-01');
  assert.equal(shiftDay('2028-02-28', 1), '2028-02-29'); // 2028 is a leap year
  assert.equal(shiftDay('2028-03-01', -1), '2028-02-29');
});

test('shiftDay: year boundaries', () => {
  assert.equal(shiftDay('2026-01-01', -1), '2025-12-31');
  assert.equal(shiftDay('2026-12-31', 1), '2027-01-01');
});
