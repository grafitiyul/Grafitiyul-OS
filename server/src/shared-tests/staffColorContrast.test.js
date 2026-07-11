import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STAFF_COLORS,
  staffColorHex,
  relativeLuminance,
  contrastRatio,
  foregroundForHex,
  mixHexWithWhite,
} from '../../../shared/staffColors.mjs';

// The ONE deterministic black/white foreground decision for text over a
// palette color (calendar event pills). Rule: WCAG relative luminance →
// pick the foreground with the HIGHER contrast ratio.

const DARK = '#111827';
const LIGHT = '#FFFFFF';

test('luminance anchors: black ≈ 0, white ≈ 1', () => {
  assert.equal(relativeLuminance('#000000'), 0);
  assert.equal(relativeLuminance('#FFFFFF'), 1);
  assert.equal(relativeLuminance('not-a-color'), null);
});

test('dark colors → white text (black/charcoal, blue/purple families)', () => {
  for (const key of ['charcoal', 'navy', 'burgundy', 'purple', 'indigo', 'plum', 'steel']) {
    assert.equal(foregroundForHex(staffColorHex(key)), LIGHT, `${key} should carry white text`);
  }
  // The calendar's "unassigned = black" pill.
  assert.equal(foregroundForHex('#111827'), LIGHT);
});

test('bright colors → dark text (yellow/lime/mint and bright oranges)', () => {
  for (const key of ['yellow', 'lime', 'mint', 'aqua', 'tangerine', 'amber', 'orange', 'green']) {
    assert.equal(foregroundForHex(staffColorHex(key)), DARK, `${key} should carry dark text`);
  }
});

test('red family → white text', () => {
  for (const key of ['red', 'brick']) {
    assert.equal(foregroundForHex(staffColorHex(key)), LIGHT, `${key} should carry white text`);
  }
});

test('EVERY palette color: the chosen foreground is the max-contrast one and stays readable', () => {
  for (const { key, hex } of STAFF_COLORS) {
    const fg = foregroundForHex(hex);
    const chosen = contrastRatio(hex, fg);
    const other = contrastRatio(hex, fg === LIGHT ? DARK : LIGHT);
    assert.ok(chosen >= other, `${key}: chosen fg must not lose to the alternative`);
    // Every palette color must give its best foreground a solid ratio —
    // guards future palette additions against unreadable mid-tones.
    assert.ok(chosen >= 3.5, `${key}: best contrast ${chosen.toFixed(2)} too low`);
  }
});

test('unparseable background → safe dark default', () => {
  assert.equal(foregroundForHex(null), DARK);
  assert.equal(foregroundForHex('#12'), DARK);
});

test('mixHexWithWhite: 0 = identity, 1 = white, midpoint lightens', () => {
  assert.equal(mixHexWithWhite('#000000', 0), '#000000');
  assert.equal(mixHexWithWhite('#123456', 1), '#FFFFFF');
  assert.equal(mixHexWithWhite('#000000', 0.5), '#808080');
  // A mixed color is strictly lighter than the original.
  const base = staffColorHex('navy');
  assert.ok(relativeLuminance(mixHexWithWhite(base, 0.55)) > relativeLuminance(base));
  assert.equal(mixHexWithWhite('nope', 0.5), null);
});
