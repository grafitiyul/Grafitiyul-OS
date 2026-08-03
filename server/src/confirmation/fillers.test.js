// Confirmation Email — filler registry tests. Pure: no DB.
// Run with `npm test` (node:test).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FILLER_KIND_KEYS,
  getFillerKind,
  normalizeFillers,
  validateFillers,
  hasActiveFillers,
  fillersAffecting,
  NEW_GUIDE_DEFAULT_NOTE,
} from './fillers.js';

// ── registry shape ───────────────────────────────────────────────────────────

test('the four V1 kinds are registered', () => {
  assert.deepEqual(FILLER_KIND_KEYS, [
    'cancellation_policy',
    'activity_duration',
    'new_guide',
    'other_note',
  ]);
  assert.equal(getFillerKind('new_guide').labelHe, 'מדריך חדש');
  assert.equal(getFillerKind('nope'), null);
});

test('new-guide default wording exists in both languages', () => {
  assert.ok(NEW_GUIDE_DEFAULT_NOTE.he.length > 0);
  assert.ok(NEW_GUIDE_DEFAULT_NOTE.en.length > 0);
});

// ── normalization ────────────────────────────────────────────────────────────

test('unknown kinds are dropped, duplicates keep the first entry', () => {
  const out = normalizeFillers([
    { kind: 'mystery', noteHe: 'x' },
    { kind: 'other_note', noteHe: 'ראשון' },
    { kind: 'other_note', noteHe: 'שני' },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].noteHe, 'ראשון');
});

test('strings are trimmed, empties dropped, duration coerced to number', () => {
  const out = normalizeFillers([
    { kind: 'activity_duration', durationHours: '2.5', noteHe: '  הערה  ', noteEn: '   ' },
  ]);
  assert.deepEqual(out, [{ kind: 'activity_duration', durationHours: 2.5, noteHe: 'הערה' }]);
});

test('non-array / junk input normalizes to empty', () => {
  assert.deepEqual(normalizeFillers(null), []);
  assert.deepEqual(normalizeFillers('x'), []);
  assert.deepEqual(normalizeFillers([null, {}, { kind: null }]), []);
});

// ── validation per kind ──────────────────────────────────────────────────────

test('cancellation: mode is required and constrained', () => {
  assert.deepEqual(validateFillers([{ kind: 'cancellation_policy', mode: 'default' }]), []);
  assert.deepEqual(
    validateFillers([{ kind: 'cancellation_policy', mode: 'whatever' }]),
    [{ kind: 'cancellation_policy', errors: ['invalid_mode'] }],
  );
});

test('cancellation: policy mode needs policyId, override needs a note', () => {
  assert.deepEqual(
    validateFillers([{ kind: 'cancellation_policy', mode: 'policy' }]),
    [{ kind: 'cancellation_policy', errors: ['policy_required'] }],
  );
  assert.deepEqual(
    validateFillers([{ kind: 'cancellation_policy', mode: 'policy', policyId: 'sc_1' }]),
    [],
  );
  assert.deepEqual(
    validateFillers([{ kind: 'cancellation_policy', mode: 'override' }]),
    [{ kind: 'cancellation_policy', errors: ['note_required'] }],
  );
  assert.deepEqual(
    validateFillers([{ kind: 'cancellation_policy', mode: 'override', noteEn: 'Custom terms' }]),
    [],
  );
});

test('duration: must be a finite positive number of hours (≤ 24)', () => {
  for (const bad of [0, -1, 25, NaN, 'abc', undefined]) {
    assert.deepEqual(
      validateFillers([{ kind: 'activity_duration', durationHours: bad }]),
      [{ kind: 'activity_duration', errors: ['invalid_duration'] }],
      `durationHours=${bad}`,
    );
  }
  assert.deepEqual(validateFillers([{ kind: 'activity_duration', durationHours: 1.5 }]), []);
});

test('note kinds require at least one language', () => {
  for (const kind of ['new_guide', 'other_note']) {
    assert.deepEqual(validateFillers([{ kind }]), [{ kind, errors: ['note_required'] }]);
    assert.deepEqual(validateFillers([{ kind, noteHe: 'תוכן' }]), []);
    assert.deepEqual(validateFillers([{ kind, noteEn: 'Content' }]), []);
  }
});

test('unknown kind surfaces as a validation problem (not a crash)', () => {
  assert.deepEqual(validateFillers([{ kind: 'mystery' }]), [
    { kind: 'mystery', errors: ['unknown_kind'] },
  ]);
});

// ── preview gate + section routing ───────────────────────────────────────────

test('hasActiveFillers gates the preview dialog', () => {
  assert.equal(hasActiveFillers(null), false);
  assert.equal(hasActiveFillers([]), false);
  assert.equal(hasActiveFillers([{ kind: 'mystery' }]), false); // unknown ≠ active
  assert.equal(hasActiveFillers([{ kind: 'other_note', noteHe: 'x' }]), true);
});

test('fillersAffecting routes kinds to their email sections', () => {
  const fillers = [
    { kind: 'new_guide', noteHe: 'א' },
    { kind: 'other_note', noteEn: 'b' },
    { kind: 'activity_duration', durationHours: 2 },
  ];
  assert.deepEqual(
    fillersAffecting(fillers, 'special_terms').map((f) => f.kind),
    ['new_guide', 'other_note'],
  );
  assert.deepEqual(
    fillersAffecting(fillers, 'tour_details').map((f) => f.kind),
    ['activity_duration'],
  );
  assert.deepEqual(fillersAffecting(fillers, 'cancellation'), []);
});
