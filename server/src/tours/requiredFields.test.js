import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WON_REQUIRED_FIELDS,
  GROUP_SLOT_REQUIRED_FIELDS,
  FIELD_LABELS_HE,
  missingFields,
  DATE_RE,
  TIME_RE,
} from './requiredFields.js';

// The Tours validation gate is declarative — handlers pass a source object and
// a list; the contract below (what counts as "missing", the [{field,labelHe}]
// shape the client renders) is what these tests pin down.

const FULL_PRIVATE_DEAL = {
  activityType: 'private',
  productId: 'p1',
  productVariantId: 'v1',
  locationId: 'l1',
  tourDate: '2026-08-01',
  tourTime: '17:00',
  participants: 25,
  tourLanguage: 'he',
};

test('fully specified private deal passes the WON gate', () => {
  assert.deepEqual(missingFields(FULL_PRIVATE_DEAL, WON_REQUIRED_FIELDS.private), []);
});

test('each absent field is reported with its Hebrew label', () => {
  const missing = missingFields(
    { ...FULL_PRIVATE_DEAL, tourDate: null, tourLanguage: '' },
    WON_REQUIRED_FIELDS.private,
  );
  assert.deepEqual(
    missing.map((m) => m.field).sort(),
    ['tourDate', 'tourLanguage'],
  );
  for (const m of missing) assert.equal(m.labelHe, FIELD_LABELS_HE[m.field]);
});

test('participants must be a positive integer, not merely present', () => {
  for (const bad of [0, -3, 1.5, 'abc', null, undefined, '']) {
    const missing = missingFields(
      { ...FULL_PRIVATE_DEAL, participants: bad },
      WON_REQUIRED_FIELDS.private,
    );
    assert.deepEqual(missing.map((m) => m.field), ['participants'], `participants=${bad}`);
  }
  // Numeric strings from form inputs are accepted.
  assert.deepEqual(
    missingFields({ ...FULL_PRIVATE_DEAL, participants: '12' }, WON_REQUIRED_FIELDS.private),
    [],
  );
});

test('group deals need only activityType + participants at the deal level', () => {
  assert.deepEqual(
    missingFields({ activityType: 'group', participants: 10 }, WON_REQUIRED_FIELDS.group),
    [],
  );
});

test('group slot list: location and participants are intentionally NOT required', () => {
  assert.ok(!GROUP_SLOT_REQUIRED_FIELDS.includes('locationId'));
  assert.ok(!GROUP_SLOT_REQUIRED_FIELDS.includes('participants'));
  const slot = {
    productId: 'p1',
    productVariantId: 'v1',
    date: '2026-08-06',
    startTime: '17:00',
    tourLanguage: 'he',
    capacity: 30,
  };
  assert.deepEqual(missingFields(slot, GROUP_SLOT_REQUIRED_FIELDS), []);
  assert.deepEqual(
    missingFields({ ...slot, capacity: 0 }, GROUP_SLOT_REQUIRED_FIELDS).map((m) => m.field),
    ['capacity'],
  );
});

test('date/time formats follow the Deal working-field conventions', () => {
  assert.ok(DATE_RE.test('2026-08-06'));
  assert.ok(!DATE_RE.test('06/08/2026'));
  assert.ok(TIME_RE.test('17:00'));
  assert.ok(TIME_RE.test('09:30'));
  assert.ok(!TIME_RE.test('25:00'));
  assert.ok(!TIME_RE.test('9:30'));
});
