import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createHeldRegistration,
  confirmRegistration,
  expireRegistration,
} from './registrationLifecycle.js';
import {
  CAPACITY_STATUSES,
  CONFIRMED_STATUSES,
  countsForCapacity,
  isConfirmed,
  isHeld,
} from './registrationStatus.js';

// The conditional-registration lifecycle: held → confirmed | expired, on the
// SAME canonical TicketRegistration (no second reservation entity).

test('status sets: held + confirmed + active count for capacity; held is not confirmed', () => {
  assert.ok(countsForCapacity('held'));
  assert.ok(countsForCapacity('confirmed'));
  assert.ok(countsForCapacity('active')); // legacy = confirmed
  assert.ok(!countsForCapacity('expired'));
  assert.ok(!countsForCapacity('cancelled'));
  assert.ok(isConfirmed('active'));
  assert.ok(isConfirmed('confirmed'));
  assert.ok(!isConfirmed('held')); // probable, not confirmed
  assert.ok(isHeld('held'));
  assert.deepEqual(CAPACITY_STATUSES, ['active', 'held', 'confirmed']);
  assert.deepEqual(CONFIRMED_STATUSES, ['active', 'confirmed']);
});

// recompute is inert here (tour kind != group_slot), so we assert the row moves.
function fakeClient({ existingReg } = {}) {
  const state = { created: [], updated: [] };
  return {
    state,
    ticketRegistration: {
      create: async ({ data }) => {
        const r = { id: 'reg1', tourEventId: 'slot1', ...data };
        state.created.push(r);
        return r;
      },
      update: async ({ where, data }) => {
        const r = { id: where.id, tourEventId: 'slot1', ...data };
        state.updated.push(r);
        return r;
      },
      findFirst: async () => existingReg || null,
    },
    tourEvent: { findUnique: async () => ({ id: 'slot1', kind: 'private' }), updateMany: async () => ({ count: 0 }) },
  };
}

test('createHeldRegistration → held, with expiry + heldAt, payment pending', async () => {
  const c = fakeClient();
  const exp = new Date('2026-08-08T13:00:00Z');
  await createHeldRegistration(c, { tourEventId: 'slot1', dealId: 'd1', productVariantId: 'plain', quantity: 4, expiresAt: exp });
  const r = c.state.created[0];
  assert.equal(r.status, 'held');
  assert.equal(r.quantity, 4);
  assert.equal(r.expiresAt, exp);
  assert.ok(r.heldAt instanceof Date);
  assert.equal(r.paymentStatus, 'pending');
});

test('confirmRegistration → confirmed, expiry cleared, booking linked, identity preserved', async () => {
  const c = fakeClient();
  await confirmRegistration(c, 'reg1', { bookingId: 'bk9' });
  const r = c.state.updated[0];
  assert.equal(r.id, 'reg1'); // same row
  assert.equal(r.status, 'confirmed');
  assert.equal(r.expiresAt, null);
  assert.equal(r.bookingId, 'bk9');
  assert.ok(r.confirmedAt instanceof Date);
});

test('expireRegistration → expired (capacity released), audit timestamp set', async () => {
  const c = fakeClient();
  await expireRegistration(c, 'reg1');
  const r = c.state.updated[0];
  assert.equal(r.status, 'expired');
  assert.ok(r.expiredAt instanceof Date);
});
