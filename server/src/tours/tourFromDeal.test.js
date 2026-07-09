import test from 'node:test';
import assert from 'node:assert/strict';
import { wonGate, GROUP_LOCKED_FIELDS } from './tourFromDeal.js';

// The WON gate contract: no drafts — missing fields refuse WON; a group deal
// whose deal-side fields are complete still needs a target slot.

const FULL_PRIVATE = {
  activityType: 'private',
  productId: 'p1',
  productVariantId: 'v1',
  locationId: 'l1',
  tourDate: '2026-08-01',
  tourTime: '17:00',
  participants: 20,
  tourLanguage: 'he',
};

test('wonGate: complete private deal passes with no slot needed', () => {
  const g = wonGate(FULL_PRIVATE, undefined);
  assert.deepEqual(g.missing, []);
  assert.equal(g.needsSlot, false);
});

test('wonGate: missing activityType is itself a missing field', () => {
  const g = wonGate({ ...FULL_PRIVATE, activityType: null }, undefined);
  assert.deepEqual(g.missing.map((m) => m.field), ['activityType']);
});

test('wonGate: complete group deal without a slot demands one', () => {
  const g = wonGate({ activityType: 'group', participants: 12 }, undefined);
  assert.deepEqual(g.missing, []);
  assert.equal(g.needsSlot, true);
});

test('wonGate: group deal with a slot chosen passes', () => {
  const g = wonGate({ activityType: 'group', participants: 12 }, 'tour123');
  assert.deepEqual(g.missing, []);
  assert.equal(g.needsSlot, false);
});

test('wonGate: incomplete group deal reports fields BEFORE demanding a slot', () => {
  const g = wonGate({ activityType: 'group', participants: null }, undefined);
  assert.deepEqual(g.missing.map((m) => m.field), ['participants']);
  assert.equal(g.needsSlot, false);
});

test('group locked fields cover exactly the slot-owned planning fields', () => {
  assert.deepEqual(
    [...GROUP_LOCKED_FIELDS].sort(),
    ['locationId', 'productId', 'productVariantId', 'tourDate', 'tourLanguage', 'tourTime'].sort(),
  );
});
