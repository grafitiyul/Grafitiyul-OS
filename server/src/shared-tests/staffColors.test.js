import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STAFF_COLORS,
  isStaffColorKey,
  staffColorHex,
  staffColorNameHe,
} from '../../../shared/staffColors.mjs';

// Canonical staff palette — validation contract + curation invariants.

test('palette size and uniqueness (30–40 distinct curated colors)', () => {
  assert.ok(STAFF_COLORS.length >= 30 && STAFF_COLORS.length <= 40, `size=${STAFF_COLORS.length}`);
  const keys = new Set(STAFF_COLORS.map((c) => c.key));
  const hexes = new Set(STAFF_COLORS.map((c) => c.hex.toLowerCase()));
  assert.equal(keys.size, STAFF_COLORS.length, 'keys unique');
  assert.equal(hexes.size, STAFF_COLORS.length, 'hex values unique');
  for (const c of STAFF_COLORS) {
    assert.match(c.hex, /^#[0-9A-Fa-f]{6}$/, `${c.key} hex format`);
    assert.ok(c.nameHe, `${c.key} has a Hebrew name`);
  }
});

test('key validation + lookups', () => {
  assert.equal(isStaffColorKey('coral'), true);
  assert.equal(isStaffColorKey('not-a-color'), false);
  assert.equal(isStaffColorKey(null), false);
  assert.equal(staffColorHex('orange'), '#F97316');
  assert.equal(staffColorHex('nope'), null);
  assert.equal(staffColorNameHe('teal'), 'טורקיז כהה');
});

test('yellow — a plain recognizable yellow, added as a NEW key', () => {
  // Server validation (people routes) accepts it via isStaffColorKey.
  assert.equal(isStaffColorKey('yellow'), true);
  assert.equal(staffColorHex('yellow'), '#FACC15');
  assert.equal(staffColorNameHe('yellow'), 'צהוב');
  // Nothing was repurposed: the neighboring warm keys all still exist with
  // their own hex — saved colors keep their meaning without a migration.
  assert.equal(staffColorHex('amber'), '#F59E0B');
  assert.equal(staffColorHex('gold'), '#D9A404');
  assert.equal(staffColorHex('mustard'), '#B8860B');
  assert.equal(staffColorHex('lime'), '#84CC16');
  assert.equal(staffColorHex('orange'), '#F97316');
});
