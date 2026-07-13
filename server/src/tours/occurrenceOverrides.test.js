import test from 'node:test';
import assert from 'node:assert/strict';
import { planExceptionForSlot, applyExceptionToSlots } from './occurrenceOverrides.js';

// The occurrence-override rules: what a cancel/time_override exception does to an
// already-materialized slot, and the reconciliation over a date's slots.

test('cancel exception cancels an empty slot but SKIPS one with registrations', () => {
  assert.deepEqual(planExceptionForSlot({ type: 'cancel' }, { startTime: '17:00' }, 0), { action: 'cancel' });
  assert.deepEqual(planExceptionForSlot({ type: 'cancel' }, { startTime: '17:00' }, 3), {
    action: 'skip',
    reason: 'has_registrations',
  });
});

test('time_override retimes only when the time actually differs', () => {
  assert.deepEqual(planExceptionForSlot({ type: 'time_override', time: '20:00' }, { startTime: '17:00' }, 0), {
    action: 'retime',
    data: { startTime: '20:00' },
  });
  assert.deepEqual(planExceptionForSlot({ type: 'time_override', time: '17:00' }, { startTime: '17:00' }, 5), {
    action: 'skip',
    reason: 'noop',
  });
});

test("an 'add' exception is not applied to existing slots (generation handles it)", () => {
  assert.deepEqual(planExceptionForSlot({ type: 'add', time: '11:00' }, { startTime: '17:00' }, 0), {
    action: 'skip',
    reason: 'not_applicable',
  });
});

// Fake client: two scheduled slots on the exception date; one has registrations.
function fakeClient({ slots, regsById }) {
  const updates = [];
  return {
    updates,
    tourEvent: {
      findMany: async () => slots,
      update: async ({ where, data }) => {
        updates.push({ id: where.id, data });
        return { id: where.id, ...data };
      },
    },
    ticketRegistration: {
      count: async ({ where }) => regsById[where.tourEventId] || 0,
    },
  };
}

test('applyExceptionToSlots: cancel skips the slot with registrations, cancels the empty one', async () => {
  const client = fakeClient({
    slots: [
      { id: 's_empty', startTime: '17:00' },
      { id: 's_booked', startTime: '17:00' },
    ],
    regsById: { s_booked: 4 },
  });
  const summary = await applyExceptionToSlots(client, 'tpl1', { type: 'cancel', date: '2026-08-06' });
  assert.deepEqual(summary, { cancelled: 1, retimed: 0, skipped: 1 });
  assert.equal(client.updates.length, 1);
  assert.equal(client.updates[0].id, 's_empty');
  assert.equal(client.updates[0].data.status, 'cancelled');
});

test('applyExceptionToSlots: time_override retimes matching slots', async () => {
  const client = fakeClient({
    slots: [{ id: 's1', startTime: '17:00' }],
    regsById: { s1: 9 }, // registrations do NOT block a retime
  });
  const summary = await applyExceptionToSlots(client, 'tpl1', {
    type: 'time_override',
    date: '2026-08-06',
    time: '20:30',
  });
  assert.deepEqual(summary, { cancelled: 0, retimed: 1, skipped: 0 });
  assert.equal(client.updates[0].data.startTime, '20:30');
});
