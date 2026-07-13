import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveCardStatus } from './cardStatus.js';

// Per-card status truth table — the fix for the misleading "מסונכרן" that was
// reused from the TourEvent-level flag across every card panel.

test('synced only when ALL expected variations are linked+synced', () => {
  assert.equal(deriveCardStatus({ mapped: true, expected: 2, syncedCount: 2 }), 'synced');
  assert.equal(deriveCardStatus({ mapped: true, expected: 2, syncedCount: 1 }), 'incomplete');
  // The exact bug: tour is 'synced' but this card produced ZERO variations.
  assert.equal(deriveCardStatus({ mapped: true, expected: 2, syncedCount: 0, tourStatus: 'synced' }), 'missing');
});

test('not offered / unmapped / no tickets are distinct', () => {
  assert.equal(deriveCardStatus({ offered: false, mapped: false, expected: 0, syncedCount: 0 }), 'not_offered');
  assert.equal(deriveCardStatus({ offered: true, mapped: false, expected: 2, syncedCount: 0 }), 'unmapped');
  assert.equal(deriveCardStatus({ offered: true, mapped: true, expected: 0, syncedCount: 0 }), 'no_tickets');
});

test('failure beats a partial success; pending shows while in flight', () => {
  assert.equal(deriveCardStatus({ mapped: true, expected: 2, syncedCount: 1, failed: true }), 'failed');
  assert.equal(deriveCardStatus({ mapped: true, expected: 2, syncedCount: 0, tourStatus: 'failed' }), 'failed');
  assert.equal(deriveCardStatus({ mapped: true, expected: 2, syncedCount: 0, tourStatus: 'pending' }), 'pending');
});
