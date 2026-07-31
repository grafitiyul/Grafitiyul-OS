import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attributionBuckets,
  resolveTourState,
  selectActivityDealForContact,
  touchDealsForEmailThread,
  touchDealsForWhatsAppChat,
} from './conversationActivity.js';
import { israelToday, addDays } from '../lib/israelDate.js';

const NOW = Date.parse('2026-07-31T09:00:00Z');
const TODAY = israelToday(NOW);
const daysAgo = (n) => new Date(NOW - n * 86_400_000);

const deal = (over) => ({
  id: 'd', status: 'open', tourDate: null, lostAt: null, valueMinor: 100000,
  createdAt: daysAgo(30), lastMeaningfulActivityAt: null, ...over,
});

// db double: deal.findMany for the ladder, icountDocument.findMany for P3,
// $executeRaw for touchDealActivity (tagged template → last value is the id).
function fakeDb(deals, docs = [], bookings = []) {
  const touched = [];
  return {
    touched,
    deal: { findMany: async () => deals },
    icountDocument: { findMany: async () => docs },
    booking: { findMany: async () => bookings },
    $executeRaw: async (_s, ...v) => { touched.push(v[v.length - 1]); },
  };
}

// A deal↔tour link. status = the BOOKING's; ev = the TourEvent's.
const booking = (dealId, evStatus, evDate, status = 'active') => ({
  dealId, status, tourEvent: { status: evStatus, date: evDate },
});

// ── the ladder ─────────────────────────────────────────────────────────────

test('P1 beats every lower bucket — an open deal wins over a recently toured WON', async () => {
  const db = fakeDb([
    deal({ id: 'won-recent', status: 'won', tourDate: addDays(TODAY, -3) }),
    deal({ id: 'open-1', status: 'open' }),
  ], [], [booking('won-recent', 'completed', addDays(TODAY, -3))]);
  assert.equal(await selectActivityDealForContact('c1', db, { now: NOW }), 'open-1');
});

test('WON + future ACTIVE tour → P1 (scenario 1)', async () => {
  const d = deal({ id: 'won-live', status: 'won', tourDate: addDays(TODAY, 5) });
  const db = fakeDb([d], [], [booking('won-live', 'scheduled', addDays(TODAY, 5))]);
  assert.equal(await selectActivityDealForContact('c1', db, { now: NOW }), 'won-live');
});

test('WON + future CANCELLED tour → NOT P1, even with a future tourDate (scenario 2)', async () => {
  // The stale-date trap: Deal.tourDate still says the tour is ahead.
  const d = deal({ id: 'won-cancelled', status: 'won', tourDate: addDays(TODAY, 5), valueMinor: 0 });
  const db = fakeDb([d], [], [booking('won-cancelled', 'cancelled', addDays(TODAY, 5))]);
  const [p1] = attributionBuckets([d], {
    today: TODAY, now: NOW,
    tourState: await resolveTourState(['won-cancelled'], db, TODAY),
  });
  assert.deepEqual(p1, [], 'a cancelled tour must never reach P1');
});

test('WON + NO TourEvent + future planned date → P1 by pre-live fallback (scenario 3)', async () => {
  const d = deal({ id: 'pre-live', status: 'won', tourDate: addDays(TODAY, 5) });
  const db = fakeDb([d], [], []); // never booked
  assert.equal(await selectActivityDealForContact('c1', db, { now: NOW }), 'pre-live');
});

test('WON with one ACTIVE future tour and one CANCELLED → P1 (scenario 4)', async () => {
  const d = deal({ id: 'mixed', status: 'won', tourDate: addDays(TODAY, 5) });
  const db = fakeDb([d], [], [
    booking('mixed', 'cancelled', addDays(TODAY, 3)),
    booking('mixed', 'scheduled', addDays(TODAY, 9)),
  ]);
  assert.equal(await selectActivityDealForContact('c1', db, { now: NOW }), 'mixed');
});

test('an ALL-cancelled deal gets NO date fallback — that is the stale-date guard', async () => {
  const d = deal({ id: 'dead', status: 'won', tourDate: addDays(TODAY, 30), valueMinor: 0 });
  const db = fakeDb([d], [], [booking('dead', 'cancelled', addDays(TODAY, 30))]);
  const state = await resolveTourState(['dead'], db, TODAY);
  const [p1] = attributionBuckets([d], { today: TODAY, now: NOW, tourState: state });
  assert.deepEqual(p1, []);
  assert.ok(state.hasAnyBooking.has('dead'), 'it HAS bookings, so the date column is ignored');
});

test('a CANCELLED BOOKING on a live tour does not qualify — both sides must be alive', async () => {
  const d = deal({ id: 'unbooked', status: 'won', tourDate: addDays(TODAY, 6) });
  const db = fakeDb([d], [], [booking('unbooked', 'scheduled', addDays(TODAY, 6), 'cancelled')]);
  const state = await resolveTourState(['unbooked'], db, TODAY);
  assert.equal(state.futureActive.has('unbooked'), false);
  assert.equal(state.hasAnyBooking.has('unbooked'), true);
});

test('a POSTPONED tour counts as live future work (no date by contract)', async () => {
  const d = deal({ id: 'postponed', status: 'won', tourDate: null });
  const db = fakeDb([d], [], [booking('postponed', 'postponed', null)]);
  assert.equal(await selectActivityDealForContact('c1', db, { now: NOW }), 'postponed');
});

test('a COMPLETED tour is not future work', async () => {
  const d = deal({ id: 'done', status: 'won', tourDate: addDays(TODAY, -2) });
  const db = fakeDb([d], [], [booking('done', 'completed', addDays(TODAY, -2))]);
  const state = await resolveTourState(['done'], db, TODAY);
  assert.equal(state.futureActive.has('done'), false);
});

test('P2 is the 14-day wrap-up window, inclusive at both ends', () => {
  const deals = [
    deal({ id: 'edge-in', status: 'won', tourDate: addDays(TODAY, -14) }),
    deal({ id: 'edge-out', status: 'won', tourDate: addDays(TODAY, -15) }),
    deal({ id: 'today', status: 'won', tourDate: TODAY }),
  ];
  const [, p2] = attributionBuckets(deals, { today: TODAY, now: NOW });
  assert.deepEqual(p2.map((d) => d.id).sort(), ['edge-in', 'today']);
});

test('P3 = WON with an outstanding balance, and it is only consulted when P1+P2 are empty', async () => {
  const deals = [
    deal({ id: 'won-paid', status: 'won', tourDate: addDays(TODAY, -60), valueMinor: 100000 }),
    deal({ id: 'won-owing', status: 'won', tourDate: addDays(TODAY, -60), valueMinor: 100000 }),
  ];
  const docs = [
    { dealId: 'won-paid', doctype: 'receipt', amountMinor: 100000, createdAt: daysAgo(50) },
    { dealId: 'won-owing', doctype: 'receipt', amountMinor: 40000, createdAt: daysAgo(50) },
  ];
  assert.equal(await selectActivityDealForContact('c1', fakeDb(deals, docs), { now: NOW }), 'won-owing');
});

test('a WON deal that was never priced counts as outstanding, not as settled', async () => {
  const deals = [deal({ id: 'unpriced', status: 'won', tourDate: addDays(TODAY, -60), valueMinor: 0 })];
  assert.equal(await selectActivityDealForContact('c1', fakeDb(deals, []), { now: NOW }), 'unpriced');
});

test('P4 = LOST within 3 months; an older loss is out of reach entirely', async () => {
  const fresh = fakeDb([deal({ id: 'lost-recent', status: 'lost', lostAt: daysAgo(30) })]);
  assert.equal(await selectActivityDealForContact('c1', fresh, { now: NOW }), 'lost-recent');
  const stale = fakeDb([deal({ id: 'lost-old', status: 'lost', lostAt: daysAgo(200) })]);
  assert.equal(await selectActivityDealForContact('c1', stale, { now: NOW }), null);
});

test('NOTHING matches → nothing is stamped (a paid, long-finished deal is not activity)', async () => {
  const deals = [deal({ id: 'done', status: 'won', tourDate: addDays(TODAY, -200), valueMinor: 100000 })];
  const docs = [{ dealId: 'done', doctype: 'receipt', amountMinor: 100000, createdAt: daysAgo(190) }];
  const db = fakeDb(deals, docs);
  assert.equal(await touchDealsForWhatsAppChat({ contactId: 'c1' }, new Date(NOW), db), 0);
  assert.deepEqual(db.touched, [], 'no deal was moved');
});

// ── tie-breaking ───────────────────────────────────────────────────────────

test('tie-break 1: most recent lastMeaningfulActivityAt wins inside a bucket', async () => {
  const db = fakeDb([
    deal({ id: 'stale', status: 'open', lastMeaningfulActivityAt: daysAgo(9) }),
    deal({ id: 'warm', status: 'open', lastMeaningfulActivityAt: daysAgo(1) }),
  ]);
  assert.equal(await selectActivityDealForContact('c1', db, { now: NOW }), 'warm');
});

test('tie-break 2: equal activity → the newest deal', async () => {
  const same = daysAgo(4);
  const db = fakeDb([
    deal({ id: 'older', status: 'open', lastMeaningfulActivityAt: same, createdAt: daysAgo(50) }),
    deal({ id: 'newer', status: 'open', lastMeaningfulActivityAt: same, createdAt: daysAgo(5) }),
  ]);
  assert.equal(await selectActivityDealForContact('c1', db, { now: NOW }), 'newer');
});

test('tie-break 3: fully tied → lowest id, so the choice is STABLE across replays', async () => {
  const same = daysAgo(4);
  const made = daysAgo(20);
  const rows = [
    deal({ id: 'bbb', status: 'open', lastMeaningfulActivityAt: same, createdAt: made }),
    deal({ id: 'aaa', status: 'open', lastMeaningfulActivityAt: same, createdAt: made }),
  ];
  assert.equal(await selectActivityDealForContact('c1', fakeDb(rows), { now: NOW }), 'aaa');
  // Same input, reversed order — a sweep re-seeing a message must not flip.
  assert.equal(await selectActivityDealForContact('c1', fakeDb([...rows].reverse()), { now: NOW }), 'aaa');
});

// ── NO FAN-OUT (the regression this replaced) ──────────────────────────────

test('several open deals on one contact stamp EXACTLY ONE deal', async () => {
  const db = fakeDb([
    deal({ id: 'open-a', status: 'open', lastMeaningfulActivityAt: daysAgo(2) }),
    deal({ id: 'open-b', status: 'open', lastMeaningfulActivityAt: daysAgo(8) }),
    deal({ id: 'open-c', status: 'open', lastMeaningfulActivityAt: daysAgo(5) }),
  ]);
  assert.equal(await touchDealsForWhatsAppChat({ contactId: 'c1' }, new Date(NOW), db), 1);
  assert.deepEqual(db.touched, ['open-a'], 'one deal, chosen by the tie-break');
});

// ── channel parity + explicit links ────────────────────────────────────────

test('an EXPLICIT email link wins outright — the ladder is not consulted', async () => {
  const db = fakeDb([deal({ id: 'open-a', status: 'open' })]);
  assert.equal(await touchDealsForEmailThread({ linkedDealId: 'chosen', contactId: 'c1' }, new Date(NOW), db), 1);
  assert.deepEqual(db.touched, ['chosen']);
});

test('Gmail and WhatsApp resolve a contact-only conversation IDENTICALLY', async () => {
  const rows = [
    deal({ id: 'won-recent', status: 'won', tourDate: addDays(TODAY, -3) }),
    deal({ id: 'open-1', status: 'open' }),
  ];
  const wa = fakeDb(rows);
  const mail = fakeDb(rows);
  await touchDealsForWhatsAppChat({ contactId: 'c1' }, new Date(NOW), wa);
  await touchDealsForEmailThread({ linkedDealId: null, contactId: 'c1' }, new Date(NOW), mail);
  assert.deepEqual(wa.touched, mail.touched);
  assert.deepEqual(wa.touched, ['open-1']);
});

test('an unmatched chat and a contactless thread both touch nothing', async () => {
  const db = fakeDb([deal({ id: 'open-a', status: 'open' })]);
  assert.equal(await touchDealsForWhatsAppChat({ contactId: null }, new Date(NOW), db), 0);
  assert.equal(await touchDealsForEmailThread({ linkedDealId: null, contactId: null }, new Date(NOW), db), 0);
  assert.deepEqual(db.touched, []);
});

test('a contact with no deals at all is a no-op', async () => {
  assert.equal(await selectActivityDealForContact('c1', fakeDb([]), { now: NOW }), null);
});
