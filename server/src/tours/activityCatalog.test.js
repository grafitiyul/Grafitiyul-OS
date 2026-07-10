import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTone,
  DEFAULT_TONE,
  COMPONENT_TONES,
  DEFAULT_ACTIVITY_COMPONENTS,
  activityComponentDeletionVerdict,
  workshopLocationDeletionVerdict,
} from './activityCatalog.js';

// Pure catalog logic (Slice A). No DB — same style as productDeletionVerdict.

test('normalizeTone keeps valid tones, falls back for anything else', () => {
  for (const t of COMPONENT_TONES) assert.equal(normalizeTone(t), t);
  assert.equal(normalizeTone('not-a-tone'), DEFAULT_TONE);
  assert.equal(normalizeTone(undefined), DEFAULT_TONE);
  assert.equal(normalizeTone(''), DEFAULT_TONE);
});

test('seeded defaults: workshops are exactly the "סדנה" components', () => {
  const workshops = DEFAULT_ACTIVITY_COMPONENTS.filter((c) => c.isWorkshop).map((c) => c.nameHe);
  assert.deepEqual(workshops.sort(), ['סדנת ציור קיר', 'סדנת תקליטים'].sort());
  // Every seeded color is a valid tone.
  for (const c of DEFAULT_ACTIVITY_COMPONENTS) assert.ok(COMPONENT_TONES.includes(c.color));
});

test('activity component with no references → hard delete allowed', () => {
  const v = activityComponentDeletionVerdict({ productLinks: 0, tourEventLinks: 0 });
  assert.equal(v.canHardDelete, true);
  assert.deepEqual(v.blockers, []);
});

test('activity component used by a product default → blocked', () => {
  const v = activityComponentDeletionVerdict({ productLinks: 2, tourEventLinks: 0 });
  assert.equal(v.canHardDelete, false);
  assert.deepEqual(v.blockers, [{ kind: 'productLinks', count: 2 }]);
});

test('activity component used by a tour → blocked (history must stay readable)', () => {
  const v = activityComponentDeletionVerdict({ productLinks: 0, tourEventLinks: 5 });
  assert.equal(v.canHardDelete, false);
  assert.deepEqual(v.blockers, [{ kind: 'tourEventLinks', count: 5 }]);
});

test('workshop location used by a tour → blocked; unused → allowed', () => {
  assert.equal(workshopLocationDeletionVerdict({ tourEventLinks: 3 }).canHardDelete, false);
  assert.equal(workshopLocationDeletionVerdict({}).canHardDelete, true);
  assert.equal(workshopLocationDeletionVerdict().canHardDelete, true);
});
