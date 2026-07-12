import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUnrestricted, collapseSelection, toggleValue } from './multiSelectCore.js';

// Regression suite for the general-additions incident (2026-07): a persisted
// "all guides checked" selection silently became a RESTRICTIVE filter when
// the guide option set grew (a תוספת כללית added 12 new payroll people), so
// every new person's report rows were hidden while the old rows kept
// rendering. The fix: an exhaustive selection is collapsed to [] (canonical
// unrestricted) on every write, so it can never go stale.

const OPTS = (vals) => vals.map((v) => ({ value: v, label: String(v) }));

test('isUnrestricted: empty or exhaustive selection means no filtering', () => {
  const options = OPTS(['a', 'b']);
  assert.equal(isUnrestricted([], options), true);
  assert.equal(isUnrestricted(['a', 'b'], options), true);
  assert.equal(isUnrestricted(['a'], options), false);
});

test('collapseSelection: exhaustive coverage collapses to []', () => {
  const options = OPTS(['a', 'b']);
  assert.deepEqual(collapseSelection(['a', 'b'], options), []);
  assert.deepEqual(collapseSelection(['b', 'a'], options), []);
});

test('collapseSelection: partial selections pass through untouched', () => {
  const options = OPTS(['a', 'b', 'c']);
  assert.deepEqual(collapseSelection(['a', 'c'], options), ['a', 'c']);
  assert.deepEqual(collapseSelection([], options), []);
});

test('collapseSelection: coverage is value-by-value, never by length (stale ids)', () => {
  // Two stale ids + one real one: length equals options length but coverage
  // is incomplete — must NOT collapse to unrestricted.
  const options = OPTS(['a', 'b', 'c']);
  assert.deepEqual(collapseSelection(['a', 'zz', 'yy'], options), ['a', 'zz', 'yy']);
  // Stale extras on top of full coverage still collapse.
  assert.deepEqual(collapseSelection(['a', 'b', 'c', 'zz'], options), []);
});

test('collapseSelection: empty option set (options not loaded yet) is a no-op', () => {
  assert.deepEqual(collapseSelection(['a'], []), ['a']);
});

test('toggleValue: checking the last unchecked option lands on [] (not the full list)', () => {
  const options = OPTS(['a', 'b']);
  assert.deepEqual(toggleValue(['a'], options, 'b'), []);
});

test('toggleValue: normal add/remove keeps explicit values', () => {
  const options = OPTS(['a', 'b', 'c']);
  assert.deepEqual(toggleValue(['a'], options, 'b').sort(), ['a', 'b']);
  assert.deepEqual(toggleValue(['a', 'b'], options, 'b'), ['a']);
});

test('INCIDENT regression: "all checked" survives option-set growth as unrestricted', () => {
  // Yesterday: only two tour guides existed and the user checked both — the
  // canonical stored form is [].
  const before = OPTS(['guide:13', 'guide:3']);
  const stored = toggleValue(['guide:13'], before, 'guide:3');
  assert.deepEqual(stored, []);
  // Today: a תוספת כללית adds 12 new people to the options. The stored
  // selection must still be unrestricted — nobody's rows disappear.
  const after = OPTS(['guide:13', 'guide:3', 'guide:1', 'candidate:596', 'candidate:578']);
  assert.equal(isUnrestricted(stored, after), true);
  // The OLD (pre-fix) stored form is exactly the poison this guards against:
  const legacyStored = ['guide:13', 'guide:3'];
  assert.equal(isUnrestricted(legacyStored, after), false);
});
