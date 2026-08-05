// The WON operational-recovery state contract (production #27074): a WON deal
// with no tour must present exactly one recovery action, the banner must stay
// through the whole completion chain, and it must disappear only when the
// chain is complete. Run with `npm test` (node:test).

import test from 'node:test';
import assert from 'node:assert/strict';
import { wonRecoveryState } from './wonRecovery.js';

const fakeDb = (openCard = null) => ({
  reviewItem: { findFirst: async () => openCard },
});

// Time-independent fixtures: a tour date safely in the future + a fresh wonAt,
// so the LIVE-obligation gate always sees an actionable deal.
const FUTURE = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const wonDeal = (over = {}) => ({
  id: 'd1',
  status: 'won',
  wonAt: new Date(),
  activityType: 'business',
  productId: 'p1',
  productVariantId: 'v1',
  locationId: 'l1',
  tourDate: FUTURE,
  tourTime: '10:00',
  participants: 3,
  tourLanguage: 'he',
  bookings: [],
  ...over,
});

test('open deal → no recovery state', async () => {
  assert.equal(await wonRecoveryState(fakeDb(), wonDeal({ status: 'open' })), null);
});

test('WON without booking → plan_tour with the gate checklist (#27074: activityType)', async () => {
  const state = await wonRecoveryState(fakeDb(), wonDeal({ activityType: null }));
  assert.equal(state.state, 'plan_tour');
  assert.deepEqual(state.missing.map((m) => m.field), ['activityType']);
});

test('WON without booking, all fields complete → plan_tour, nothing missing', async () => {
  const state = await wonRecoveryState(fakeDb(), wonDeal());
  assert.equal(state.state, 'plan_tour');
  assert.equal(state.missing.length, 0);
  assert.equal(state.needsSlot, false);
});

test('complete group deal without booking → plan_tour with needsSlot', async () => {
  const state = await wonRecoveryState(fakeDb(), wonDeal({ activityType: 'group' }));
  assert.equal(state.state, 'plan_tour');
  assert.equal(state.needsSlot, true);
});

test('tour exists but the confirmation email is still blocked → banner MORPHS, never vanishes', async () => {
  const card = {
    data: {
      autoSendError: 'send_blocked',
      autoSendWarnings: [{ code: 'no_tour', label: 'נקודת מפגש' }],
    },
  };
  const state = await wonRecoveryState(
    fakeDb(card),
    wonDeal({ bookings: [{ status: 'active', tourEvent: { id: 't1' } }] }),
  );
  assert.equal(state.state, 'confirmation_pending');
  assert.equal(state.reasonHe, 'אין סיור משובץ — נקודת המפגש חסרה');
});

test('chain complete (tour + email handled) → banner gone', async () => {
  const state = await wonRecoveryState(
    fakeDb(null),
    wonDeal({ bookings: [{ status: 'active', tourEvent: { id: 't1' } }] }),
  );
  assert.equal(state, null);
});

test('legacy WON deal (no date, won long ago) → NOT an actionable recovery', async () => {
  const state = await wonRecoveryState(
    fakeDb(),
    wonDeal({ tourDate: null, wonAt: new Date('2022-05-01') }),
  );
  assert.equal(state, null);
});

test('dateless but RECENTLY won → actionable (the payment-first WON gap)', async () => {
  const state = await wonRecoveryState(fakeDb(), wonDeal({ tourDate: null }));
  assert.equal(state.state, 'plan_tour');
});

test('past tour date without a tour → history, not an emergency', async () => {
  const state = await wonRecoveryState(
    fakeDb(),
    wonDeal({ tourDate: '2021-06-15', wonAt: new Date('2021-06-01') }),
  );
  assert.equal(state, null);
});

test('orphaned booking → the orphan flow owns the deal, no second banner', async () => {
  const state = await wonRecoveryState(
    fakeDb(),
    wonDeal({ bookings: [{ status: 'orphaned', tourEvent: { id: 't1' } }] }),
  );
  assert.equal(state, null);
});
