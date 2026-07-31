// The structural invariant behind the 2026-07-31 incident:
// a Booking that still owns capacity-holding registrations must NEVER be
// auto-cancelled because a legacy Airtable row went missing.

import test from 'node:test';
import assert from 'node:assert/strict';

import { tourChildrenAdapter } from './airtableTourChildren.js';
import { diffSets } from '../modes.js';

const adapter = tourChildrenAdapter({
  loadCurrentSet: async () => [],
  applyDiff: async () => {},
});

const booking = (over = {}) => ({ kind: 'booking', id: 'bk1', dealId: 'd1', seats: 4, registrations: [], ...over });

test('a booking holding live seats is a CONFLICT, never a removal', () => {
  assert.equal(adapter.protectRemoval(booking({ registrations: [2, 2] })), 'conflict');
});

test('a booking with no live registrations may still be removed (cancelled)', () => {
  assert.equal(adapter.protectRemoval(booking({ registrations: [] })), undefined);
});

test('zero-quantity registrations do not count as live seats', () => {
  assert.equal(adapter.protectRemoval(booking({ registrations: [0, 0] })), undefined);
});

test('payroll removal remains a conflict', () => {
  assert.equal(adapter.protectRemoval({ kind: 'payroll', id: 'p1' }), 'conflict');
});

test('assignments remain freely removable — they carry no money and no seats', () => {
  assert.equal(adapter.protectRemoval({ kind: 'assignment', id: 'a1' }), undefined);
});

test('END TO END: a vanished Airtable row cannot cancel a booking with participants', () => {
  // Exactly the incident: GOS holds a migration-created booking with 8 seats;
  // Airtable has no matching row at all.
  const current = [booking({ id: 'bk_migration', registrations: [2, 4, 2] })];
  const desired = [];
  const diff = diffSets({
    current,
    desired,
    keyOf: (m) => `${m.kind}:${m.dealId ?? m.id}`,
    sameOf: (a, b) => a.seats === b.seats,
    protectRemoval: adapter.protectRemoval,
  });
  assert.equal(diff.remove.length, 0, 'the booking must NOT be queued for removal');
  assert.equal(diff.conflicts.length, 1, 'it must become an operator decision');
  assert.equal(diff.conflicts[0].kind, 'removal');
  assert.equal(diff.conflicts[0].current.id, 'bk_migration');
});

test('the conflict reads as a business sentence, not a table name', () => {
  const label = adapter.conflictLabelFor({ kind: 'removal', current: { kind: 'booking' } });
  assert.match(label, /הזמנה/);
  assert.match(label, /משתתפים/);
});
