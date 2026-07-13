import test from 'node:test';
import assert from 'node:assert/strict';
import { sweepExpiredHolds } from './heldExpiryWorker.js';

// The held-reservation expiry sweep: a HELD registration past expiresAt becomes
// EXPIRED (capacity released) with an audit event; a reservation confirmed in
// the meantime is left alone.

function fakeClient({ due = [], statusById = {} }) {
  const state = { updates: [], timeline: [] };
  return {
    state,
    // No $transaction → sweep runs inline (see worker).
    ticketRegistration: {
      findMany: async () => due,
      findUnique: async ({ where }) => ({ status: statusById[where.id] ?? 'held' }),
      update: async ({ where, data }) => {
        state.updates.push({ id: where.id, ...data });
        return { id: where.id, tourEventId: 'slot1', ...data };
      },
    },
    tourEvent: { findUnique: async () => ({ id: 'slot1', kind: 'private' }), updateMany: async () => ({ count: 0 }) },
    timelineEntry: { create: async ({ data }) => { state.timeline.push(data); return {}; } },
  };
}

test('a due HELD reservation is expired with a deal + tour audit event', async () => {
  const c = fakeClient({ due: [{ id: 'reg1', tourEventId: 'slot1', dealId: 'd1', quantity: 4, expiresAt: new Date() }] });
  const n = await sweepExpiredHolds(c, { now: new Date() });
  assert.equal(n, 1);
  assert.equal(c.state.updates[0].status, 'expired');
  assert.ok(c.state.updates[0].expiredAt instanceof Date);
  const events = c.state.timeline.map((t) => t.data.event);
  assert.ok(events.includes('hold_expired'));
  // Both the deal and the tour got an audit entry.
  assert.ok(c.state.timeline.some((t) => t.subjectType === 'deal'));
  assert.ok(c.state.timeline.some((t) => t.subjectType === 'tour_event'));
});

test('a reservation confirmed since selection is NOT expired (race-safe)', async () => {
  const c = fakeClient({
    due: [{ id: 'reg1', tourEventId: 'slot1', dealId: 'd1', quantity: 4, expiresAt: new Date() }],
    statusById: { reg1: 'confirmed' }, // paid in the meantime
  });
  const n = await sweepExpiredHolds(c, { now: new Date() });
  assert.equal(n, 0);
  assert.equal(c.state.updates.length, 0);
});
