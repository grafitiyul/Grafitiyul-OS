import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_STATUS_FILTER,
  STATUS_FILTER_CHOICES,
  TOUR_STATUSES,
  normalizeStatusFilter,
} from './config.js';

// The ONE canonical multi-select status state for Table + Calendar: default,
// legacy single-select migration, and the documented empty-selection reset.

test('default filter is עתידי + נדחה (cancelled never included by default)', () => {
  assert.deepEqual(DEFAULT_STATUS_FILTER, ['scheduled', 'postponed']);
  assert.deepEqual(normalizeStatusFilter(undefined), DEFAULT_STATUS_FILTER);
  assert.deepEqual(normalizeStatusFilter(null), DEFAULT_STATUS_FILTER);
});

test('valid arrays pass through deduped and validated', () => {
  assert.deepEqual(normalizeStatusFilter(['completed']), ['completed']);
  assert.deepEqual(normalizeStatusFilter(['scheduled', 'cancelled', 'scheduled']), [
    'scheduled',
    'cancelled',
  ]);
  assert.deepEqual(normalizeStatusFilter(['bogus', 'completed']), ['completed']);
});

test('empty selection resets to the documented default (never "show everything")', () => {
  assert.deepEqual(normalizeStatusFilter([]), DEFAULT_STATUS_FILTER);
  assert.deepEqual(normalizeStatusFilter(['nope']), DEFAULT_STATUS_FILTER);
});

test('LEGACY migration: old single-select preference maps in place', () => {
  assert.deepEqual(normalizeStatusFilter('active'), DEFAULT_STATUS_FILTER);
  assert.deepEqual(normalizeStatusFilter('all'), [...TOUR_STATUSES]);
  assert.deepEqual(normalizeStatusFilter('cancelled'), ['cancelled']);
  assert.deepEqual(normalizeStatusFilter('garbage'), DEFAULT_STATUS_FILTER);
});

test('filter choices cover exactly the four canonical statuses with Hebrew labels', () => {
  assert.deepEqual(
    STATUS_FILTER_CHOICES.map((c) => c.value),
    ['scheduled', 'completed', 'cancelled', 'postponed'],
  );
  const labels = Object.fromEntries(STATUS_FILTER_CHOICES.map((c) => [c.value, c.label]));
  assert.equal(labels.scheduled, 'עתידי');
  assert.equal(labels.completed, 'הסתיים');
  assert.equal(labels.cancelled, 'בוטל');
  assert.equal(labels.postponed, 'נדחה');
});
