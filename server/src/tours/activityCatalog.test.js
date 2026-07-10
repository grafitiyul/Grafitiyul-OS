import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTone,
  DEFAULT_TONE,
  COMPONENT_TONES,
  DEFAULT_ACTIVITY_COMPONENTS,
  activityComponentDeletionVerdict,
  workshopLocationDeletionVerdict,
  sanitizeComponentSelection,
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

// ── sanitizeComponentSelection (Product defaults + Tour components) ──

const CAT = { validIds: ['a', 'b', 'c'], activeIds: ['a', 'b'] };

test('selection preserves requested order', () => {
  assert.deepEqual(sanitizeComponentSelection(['b', 'a'], CAT).ids, ['b', 'a']);
});

test('selection collapses duplicates, first occurrence wins', () => {
  assert.deepEqual(sanitizeComponentSelection(['a', 'b', 'a'], CAT).ids, ['a', 'b']);
});

test('selection drops unknown ids', () => {
  const r = sanitizeComponentSelection(['a', 'zzz', 'b'], CAT);
  assert.deepEqual(r.ids, ['a', 'b']);
  assert.deepEqual(r.rejected, [{ id: 'zzz', reason: 'unknown' }]);
});

test('selection blocks NEWLY adding an inactive component', () => {
  // c is valid but inactive and not already linked → rejected.
  const r = sanitizeComponentSelection(['a', 'c'], CAT);
  assert.deepEqual(r.ids, ['a']);
  assert.deepEqual(r.rejected, [{ id: 'c', reason: 'inactive' }]);
});

test('selection keeps an inactive component that was ALREADY linked', () => {
  // retiring a component must not corrupt saved config that already used it.
  const r = sanitizeComponentSelection(['a', 'c'], { ...CAT, existingIds: ['c'] });
  assert.deepEqual(r.ids, ['a', 'c']);
  assert.deepEqual(r.rejected, []);
});

test('selection tolerates empty / non-array input', () => {
  assert.deepEqual(sanitizeComponentSelection(undefined, CAT).ids, []);
  assert.deepEqual(sanitizeComponentSelection([], CAT).ids, []);
  assert.deepEqual(sanitizeComponentSelection([null, 1, {}], CAT).ids, []);
});
