import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWonActor, wonActorLabel } from './wonActor.js';

// The canonical "who closed this deal" contract: the frozen shape written at
// the WON transition, and the ONE display resolver every surface uses.

test('buildWonActor freezes a real user identity: id + names + cause + at', () => {
  const at = new Date('2026-08-05T10:00:00Z');
  const actor = buildWonActor({
    user: { id: 'u1', displayName: 'דור קורן', username: 'dorko' },
    cause: 'manual',
    at,
  });
  assert.deepEqual(actor, {
    type: 'user',
    userId: 'u1',
    displayName: 'דור קורן',
    username: 'dorko',
    cause: 'manual',
    at: '2026-08-05T10:00:00.000Z',
  });
});

test('buildWonActor with no user is an explicit system attribution, never a fabricated human', () => {
  const actor = buildWonActor({ cause: 'icount_payment', at: new Date('2026-08-05T10:00:00Z') });
  assert.deepEqual(actor, { type: 'system', cause: 'icount_payment', at: '2026-08-05T10:00:00.000Z' });
  // A user object without an id cannot be attributed — also system.
  assert.equal(buildWonActor({ user: { displayName: 'x' }, cause: 'manual' }).type, 'system');
});

test('label: a named user shows the display name; username is the fallback (the ADMIN case)', () => {
  assert.equal(wonActorLabel({ type: 'user', displayName: 'דור קורן', username: 'dorko' }), 'דור קורן');
  assert.equal(wonActorLabel({ type: 'user', displayName: null, username: 'ADMIN' }), 'ADMIN');
  assert.equal(wonActorLabel({ type: 'user', displayName: 'דור קורן', username: 'dorko' }, 'en'), 'דור קורן');
});

test('label: automatic closes name the REAL source, in both languages', () => {
  assert.equal(wonActorLabel({ type: 'system', cause: 'woo_order' }), 'מערכת — תשלום WooCommerce');
  assert.equal(wonActorLabel({ type: 'system', cause: 'woo_order' }, 'en'), 'System — WooCommerce payment');
  assert.equal(wonActorLabel({ type: 'system', cause: 'cardcom_payment' }), 'מערכת — Cardcom');
  assert.equal(wonActorLabel({ type: 'system', cause: 'cardcom_payment' }, 'en'), 'System — Cardcom');
  assert.equal(wonActorLabel({ type: 'system', cause: 'icount_payment' }), 'מערכת — תשלום iCount');
  assert.equal(wonActorLabel({ type: 'system', cause: 'icount_payment' }, 'en'), 'System — iCount payment');
  assert.equal(wonActorLabel({ type: 'system', cause: 'card_payment' }), 'מערכת — תשלום אשראי');
  assert.equal(wonActorLabel({ type: 'system', cause: 'card_payment' }, 'en'), 'System — credit-card payment');
});

test('label: an unrecognized system cause degrades to a generic system attribution', () => {
  assert.equal(wonActorLabel({ type: 'system', cause: 'no_payment' }), 'מערכת');
  assert.equal(wonActorLabel({ type: 'system', cause: null }, 'en'), 'System');
});

test('label: a legacy deal with NO frozen actor says so explicitly — never a blank or a dash', () => {
  assert.equal(wonActorLabel(null), 'לא ידוע');
  assert.equal(wonActorLabel(undefined, 'en'), 'Unknown');
  assert.equal(wonActorLabel('garbage'), 'לא ידוע');
  // A user record with no resolvable name at all is also honest-unknown.
  assert.equal(wonActorLabel({ type: 'user', displayName: null, username: null }), 'לא ידוע');
});
