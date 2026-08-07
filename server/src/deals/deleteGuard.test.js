import test from 'node:test';
import assert from 'node:assert/strict';
import { dealDeletionBlockers, clearDeletableDealRefs } from './deleteGuard.js';

// The invariant: HISTORY never blocks deletion, LIVE dependency always does.
//
// Production #27104 — an agent-form order whose prices had been manipulated.
// The operator did everything right: WON, then reopen, which cancelled the tour
// correctly. The deal was then permanently undeletable, because the guard
// counted the cancelled booking left behind by that correct cleanup.

function store(init = {}) {
  const s = {
    bookings: init.bookings || [],
    registrations: init.registrations || [],
    documents: init.documents || [],
    evidence: init.evidence || [],
    payments: init.payments || [],
    reviews: init.reviews || [],
  };
  const match = (rows, where) =>
    rows.filter((r) => {
      if (where.dealId !== undefined && r.dealId !== where.dealId) return false;
      if (where.status?.in && !where.status.in.includes(r.status)) return false;
      if (where.status?.not !== undefined && r.status === where.status.not) return false;
      if (typeof where.status === 'string' && r.status !== where.status) return false;
      return true;
    });
  const counter = (key) => ({ count: async ({ where }) => match(s[key], where).length });
  return {
    _s: s,
    booking: {
      ...counter('bookings'),
      deleteMany: async ({ where }) => {
        const hit = match(s.bookings, where);
        s.bookings = s.bookings.filter((r) => !hit.includes(r));
        return { count: hit.length };
      },
    },
    ticketRegistration: counter('registrations'),
    icountDocument: counter('documents'),
    dealCollectionEvidence: counter('evidence'),
    paymentRequest: counter('payments'),
    reviewItem: {
      updateMany: async ({ where, data }) => {
        const hit = match(s.reviews, where);
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      },
    },
  };
}

const codes = (b) => b.map((x) => x.code).sort();

// ── the #27104 shape: everything cancelled, nothing owed ─────────────────────

test('a reopened deal whose booking is CANCELLED is deletable', async () => {
  const c = store({
    bookings: [{ dealId: 'd1', status: 'cancelled' }],
    registrations: [{ dealId: 'd1', status: 'cancelled' }],
  });
  assert.deepEqual(await dealDeletionBlockers(c, 'd1'), [], 'history is not a dependency');
});

test('a deal with no traces at all is deletable', async () => {
  assert.deepEqual(await dealDeletionBlockers(store(), 'd1'), []);
});

// ── still blocked: live operational dependency ──────────────────────────────

test('an ACTIVE booking still blocks', async () => {
  const c = store({ bookings: [{ dealId: 'd1', status: 'active' }] });
  assert.deepEqual(codes(await dealDeletionBlockers(c, 'd1')), ['active_booking']);
});

test('an ORPHANED booking still blocks — the tour is waiting to reconnect', async () => {
  // orphaned exists precisely so a live tour survives the deal stepping away;
  // reconnecting needs the deal to still exist.
  const c = store({ bookings: [{ dealId: 'd1', status: 'orphaned' }] });
  assert.deepEqual(codes(await dealDeletionBlockers(c, 'd1')), ['active_booking']);
});

test('live seats block even when the booking is already cancelled', async () => {
  for (const status of ['active', 'held', 'confirmed']) {
    const c = store({
      bookings: [{ dealId: 'd1', status: 'cancelled' }],
      registrations: [{ dealId: 'd1', status }],
    });
    assert.deepEqual(codes(await dealDeletionBlockers(c, 'd1')), ['live_registration'], status);
  }
});

test('released registrations do not block', async () => {
  for (const status of ['cancelled', 'expired', 'refunded']) {
    const c = store({ registrations: [{ dealId: 'd1', status }] });
    assert.deepEqual(await dealDeletionBlockers(c, 'd1'), [], status);
  }
});

// ── still blocked: accounting. These CASCADE in the database, so without this
//    check the endpoint would silently destroy tax documents. ────────────────

test('an issued accounting document blocks — deletion would cascade it away', async () => {
  const c = store({ documents: [{ dealId: 'd1', status: 'issued' }] });
  assert.deepEqual(codes(await dealDeletionBlockers(c, 'd1')), ['accounting_document']);
});

test('recorded collection money blocks; reversed evidence does not', async () => {
  assert.deepEqual(
    codes(await dealDeletionBlockers(store({ evidence: [{ dealId: 'd1', status: 'active' }] }), 'd1')),
    ['collection_evidence'],
  );
  assert.deepEqual(
    await dealDeletionBlockers(store({ evidence: [{ dealId: 'd1', status: 'reversed' }] }), 'd1'),
    [],
    'a reversed record is already neutralised',
  );
});

test('a settled payment request blocks; an unopened or dead one does not', async () => {
  for (const status of ['paid', 'payment_returned']) {
    const c = store({ payments: [{ dealId: 'd1', status }] });
    assert.deepEqual(codes(await dealDeletionBlockers(c, 'd1')), ['settled_payment'], status);
  }
  for (const status of ['pending', 'awaiting_payment', 'failed', 'canceled']) {
    const c = store({ payments: [{ dealId: 'd1', status }] });
    assert.deepEqual(await dealDeletionBlockers(c, 'd1'), [], status);
  }
});

test('every blocker is reported at once, each with operator wording', async () => {
  const c = store({
    bookings: [{ dealId: 'd1', status: 'active' }],
    registrations: [{ dealId: 'd1', status: 'confirmed' }],
    documents: [{ dealId: 'd1' }],
  });
  const b = await dealDeletionBlockers(c, 'd1');
  assert.deepEqual(codes(b), ['accounting_document', 'active_booking', 'live_registration']);
  assert.ok(b.every((x) => typeof x.labelHe === 'string' && x.labelHe.length), 'each says WHY in Hebrew');
  assert.ok(b.every((x) => x.count > 0));
});

test('blockers are scoped to the deal — another deal never blocks this one', async () => {
  const c = store({ bookings: [{ dealId: 'other', status: 'active' }] });
  assert.deepEqual(await dealDeletionBlockers(c, 'd1'), []);
});

// ── the cleanup half ────────────────────────────────────────────────────────

test('clearing removes ONLY cancelled bookings and retires open cards', async () => {
  const c = store({
    bookings: [
      { id: 'b1', dealId: 'd1', status: 'cancelled' },
      { id: 'b2', dealId: 'other', status: 'cancelled' },
    ],
    reviews: [
      { id: 'r1', dealId: 'd1', status: 'open' },
      { id: 'r2', dealId: 'd1', status: 'handled' },
    ],
  });
  const out = await clearDeletableDealRefs(c, 'd1', { actorUserId: 'u1', actorName: 'admin' });
  assert.deepEqual(out, { cancelledBookingsRemoved: 1, reviewCardsRetired: 1 });
  assert.deepEqual(c._s.bookings.map((b) => b.id), ['b2'], "another deal's history is untouched");
  const card = c._s.reviews.find((r) => r.id === 'r1');
  assert.equal(card.status, 'handled');
  assert.equal(card.handledByName, 'admin', 'who retired it is recorded');
  assert.ok(card.handledAt);
});

test('clearing never touches a live booking', async () => {
  // Belt and braces: the guard already refused, but the cleanup must not be
  // capable of destroying an active booking even if called out of order.
  const c = store({ bookings: [{ id: 'b1', dealId: 'd1', status: 'active' }] });
  const out = await clearDeletableDealRefs(c, 'd1');
  assert.equal(out.cancelledBookingsRemoved, 0);
  assert.equal(c._s.bookings.length, 1);
});
