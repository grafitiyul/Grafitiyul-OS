import test from 'node:test';
import assert from 'node:assert/strict';
import { planFutureTours } from './cutoverImport.js';

// Guide identity canonicalisation (owner decision, 2026-07-29).
// A legacy guide email is a LOOKUP key; PersonRef.externalPersonId is the
// IDENTITY. These tests pin both branches and the boundaries around them.

const FREEZE = '2026-07-29';

const master = (over = {}) => ({
  recId: 'recTour1', tourId: 101, name: 'סיור', date: '2026-08-10',
  startTime: '10:00', endTime: null, status: 'עתידי', legacyCalendarId: null,
  cardExtras: [], ...over,
});
const coord = (email, over = {}) => ({
  recId: `recC_${email}`, masterRecId: 'recTour1', legacyDealId: 5001,
  guideEmail: email, guideName: 'שם מהמערכת הישנה', seats: 10, legacyCalendarId: null, ...over,
});

function plan({ coords, identity = new Map(), refs = new Map() }) {
  return planFutureTours({
    masterTours: [master()],
    coordRows: coords,
    dealXwalk: new Map([['5001', 'gosDeal1']]),
    dealMetaByLegacyId: new Map([[5001, { activityType: 'business' }]]),
    personRefByEmail: refs,
    personIdentityByEmail: identity,
    freezeDate: FREEZE,
  });
}

const assignmentsOf = (res) => res.payloads.flatMap((p) => p.guides);

test('a MATCHED guide email is keyed by PersonRef.externalPersonId, not the email', () => {
  const res = plan({
    coords: [coord('EKissLove@Gmail.com')],
    identity: new Map([['ekisslove@gmail.com', 'guide:3']]),
    refs: new Map([['ekisslove@gmail.com', 'pr_3']]),
  });
  const [g] = assignmentsOf(res);
  assert.equal(g.identityKey, 'guide:3', 'the canonical GOS identity wins');
  assert.equal(g.personRefId, 'pr_3');
  assert.equal(g.email, 'ekisslove@gmail.com', 'the normalised email is still carried for traceability');
  assert.equal(res.stats.assignmentsCanonical, 1);
  assert.equal(res.stats.assignmentsLegacyEmail, 0);
});

test('an UNMATCHED guide email falls back to the NORMALISED email', () => {
  const res = plan({ coords: [coord('  NoSuchGuide@Example.COM  ')] });
  const [g] = assignmentsOf(res);
  assert.equal(g.identityKey, 'nosuchguide@example.com', 'lower-cased and trimmed — never the raw value');
  assert.equal(g.personRefId, null);
  assert.equal(res.stats.assignmentsCanonical, 0);
  assert.equal(res.stats.assignmentsLegacyEmail, 1);
});

test('matched and unmatched guides on the same tour each keep their own scheme', () => {
  const res = plan({
    coords: [coord('a@x.com'), coord('b@x.com')],
    identity: new Map([['a@x.com', 'guide:7']]),
    refs: new Map([['a@x.com', 'pr_7']]),
  });
  assert.deepEqual(assignmentsOf(res).map((g) => g.identityKey), ['guide:7', 'b@x.com']);
  assert.equal(res.stats.assignmentsCanonical, 1);
  assert.equal(res.stats.assignmentsLegacyEmail, 1);
});

test('a tour REDIRECTED onto a native slot carries the canonical identity too', () => {
  // Both executor paths write assignments — the create path and the redirect
  // path. A redirect lands on a slot that may already hold NATIVE assignments,
  // which is exactly where a second identity scheme would split the guide.
  const res = planFutureTours({
    masterTours: [master({ recId: 'recOpen', date: '2026-08-10', startTime: '10:00' })],
    coordRows: [
      { ...coord('a@x.com'), masterRecId: 'recOpen', legacyDealId: 5001 },
      { ...coord('b@x.com'), masterRecId: 'recOpen', legacyDealId: 5002, recId: 'recC_b' },
    ],
    dealXwalk: new Map([['5001', 'gosDeal1'], ['5002', 'gosDeal2']]),
    dealMetaByLegacyId: new Map(),
    personRefByEmail: new Map([['a@x.com', 'pr_7']]),
    personIdentityByEmail: new Map([['a@x.com', 'guide:7']]),
    nativeSlots: [{ id: 'nativeSlot1', date: '2026-08-10', startTime: '10:00', status: 'scheduled' }],
    freezeDate: FREEZE,
  });
  assert.equal(res.stats.redirectedToNative, 1, 'the native slot survives');
  assert.deepEqual(res.redirects[0].guides.map((g) => g.identityKey), ['guide:7', 'b@x.com']);
});

test('the same guide appearing twice on one tour still produces ONE assignment', () => {
  const res = plan({
    coords: [coord('a@x.com'), { ...coord('A@X.com'), recId: 'recC_dup' }],
    identity: new Map([['a@x.com', 'guide:7']]),
    refs: new Map([['a@x.com', 'pr_7']]),
  });
  assert.equal(assignmentsOf(res).length, 1, 'dedupe is by normalised email, before identity resolution');
  assert.equal(res.stats.assignments, 1);
});

test('a blank or missing guide email produces no assignment at all', () => {
  const res = plan({ coords: [coord(''), coord('   '), { ...coord('x@y.com'), guideEmail: null }] });
  assert.equal(assignmentsOf(res).length, 0);
  assert.equal(res.stats.assignments, 0);
});

test('identity resolution never changes the tour population or its bookings', () => {
  const withIdentity = plan({
    coords: [coord('a@x.com')],
    identity: new Map([['a@x.com', 'guide:7']]),
    refs: new Map([['a@x.com', 'pr_7']]),
  });
  const without = plan({ coords: [coord('a@x.com')] });
  assert.equal(withIdentity.stats.create, without.stats.create);
  assert.equal(withIdentity.stats.bookings, without.stats.bookings);
  assert.equal(withIdentity.stats.seatsTotal, without.stats.seatsTotal);
});
