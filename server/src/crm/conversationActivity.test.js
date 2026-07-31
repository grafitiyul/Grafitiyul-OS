import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attributionBuckets,
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
function fakeDb(deals, docs = []) {
  const touched = [];
  return {
    touched,
    deal: { findMany: async () => deals },
    icountDocument: { findMany: async () => docs },
    $executeRaw: async (_s, ...v) => { touched.push(v[v.length - 1]); },
  };
}

// ── the ladder ─────────────────────────────────────────────────────────────

test('P1 beats every lower bucket — an open deal wins over a recently toured WON', async () => {
  const db = fakeDb([
    deal({ id: 'won-recent', status: 'won', tourDate: addDays(TODAY, -3) }),
    deal({ id: 'open-1', status: 'open' }),
  ]);
  assert.equal(await selectActivityDealForContact('c1', db, { now: NOW }), 'open-1');
});

test('a WON deal with a FUTURE tour is P1 — the work is still ahead', () => {
  const [p1] = attributionBuckets(
    [deal({ id: 'future', status: 'won', tourDate: addDays(TODAY, 5) })],
    { today: TODAY, now: NOW },
  );
  assert.deepEqual(p1.map((d) => d.id), ['future']);
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
