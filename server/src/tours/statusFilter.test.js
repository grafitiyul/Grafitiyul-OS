import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tourStatusWhere } from './statusFilter.js';

// ONE parser for list + calendar — pins the multi-select contract, the legacy
// single-select back-compat, and the server-owned cancelled semantics.

test('one selected status → exact in-set', () => {
  assert.deepEqual(tourStatusWhere({ statuses: 'scheduled' }), {
    ok: true,
    where: { in: ['scheduled'] },
  });
});

test('several selected statuses → the exact selected set (order preserved, deduped)', () => {
  assert.deepEqual(tourStatusWhere({ statuses: 'scheduled,postponed,scheduled' }), {
    ok: true,
    where: { in: ['scheduled', 'postponed'] },
  });
  assert.deepEqual(tourStatusWhere({ statuses: 'completed,cancelled' }), {
    ok: true,
    where: { in: ['completed', 'cancelled'] },
  });
});

test('cancelled appears ONLY when explicitly requested', () => {
  // Default calendar fallback (active) excludes cancelled.
  const cal = tourStatusWhere({}, { fallback: 'active' });
  assert.deepEqual(cal, { ok: true, where: { in: ['scheduled', 'postponed'] } });
  // Explicit selection includes it.
  assert.deepEqual(tourStatusWhere({ statuses: 'cancelled' }), {
    ok: true,
    where: { in: ['cancelled'] },
  });
});

test('all four selected → unrestricted (no status clause)', () => {
  assert.deepEqual(tourStatusWhere({ statuses: 'scheduled,completed,cancelled,postponed' }), {
    ok: true,
    where: null,
  });
});

test('empty statuses param falls through to legacy/fallback handling', () => {
  assert.deepEqual(tourStatusWhere({ statuses: '' }, { fallback: 'active' }), {
    ok: true,
    where: { in: ['scheduled', 'postponed'] },
  });
  // List endpoint keeps its historical "everything" default.
  assert.deepEqual(tourStatusWhere({ statuses: '' }, { fallback: null }), { ok: true, where: null });
});

test('invalid status in the set → invalid_status error (never silently dropped)', () => {
  assert.deepEqual(tourStatusWhere({ statuses: 'scheduled,bogus' }), {
    ok: false,
    error: 'invalid_status',
  });
});

test('legacy single-select back-compat: active / all / one status / invalid', () => {
  assert.deepEqual(tourStatusWhere({ status: 'active' }), {
    ok: true,
    where: { in: ['scheduled', 'postponed'] },
  });
  assert.deepEqual(tourStatusWhere({ status: 'all' }), { ok: true, where: null });
  assert.deepEqual(tourStatusWhere({ status: 'completed' }), { ok: true, where: 'completed' });
  assert.deepEqual(tourStatusWhere({ status: 'nope' }), { ok: false, error: 'invalid_status' });
});

test('statuses wins over legacy status when both are sent', () => {
  assert.deepEqual(tourStatusWhere({ statuses: 'cancelled', status: 'active' }), {
    ok: true,
    where: { in: ['cancelled'] },
  });
});
