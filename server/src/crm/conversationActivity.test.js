import test from 'node:test';
import assert from 'node:assert/strict';
import { activityDealIdsForContact, touchDealsForEmailThread, touchDealsForWhatsAppChat } from './conversationActivity.js';

const day = 86_400_000;
const dateStr = (offsetDays) => new Date(Date.now() + offsetDays * day).toISOString().slice(0, 10);

// Minimal db double: dealsForContact() issues deal.findMany + stage/org
// lookups, and touchDealActivity issues $executeRaw. We record the raw writes.
function fakeDb(deals) {
  const touched = [];
  return {
    touched,
    deal: { findMany: async () => deals },
    dealStage: { findMany: async () => [] },
    organization: { findMany: async () => [] },
    // touchDealActivity uses a tagged template: (strings, ...values).
    $executeRaw: async (_strings, ...values) => { touched.push(values[values.length - 1]); },
  };
}

test('open deals are candidates; lost and old-won are not', async () => {
  const db = fakeDb([
    { id: 'open-1', status: 'open', tourDate: null, dealStageId: null, organizationId: null },
    { id: 'lost-1', status: 'lost', tourDate: null, dealStageId: null, organizationId: null },
    { id: 'won-old', status: 'won', tourDate: dateStr(-60), dealStageId: null, organizationId: null },
  ]);
  assert.deepEqual(await activityDealIdsForContact('c1', db), ['open-1']);
});

test('a WON deal toured within 7 days still counts — the work is live', async () => {
  const db = fakeDb([{ id: 'won-recent', status: 'won', tourDate: dateStr(-2), dealStageId: null, organizationId: null }]);
  assert.deepEqual(await activityDealIdsForContact('c1', db), ['won-recent']);
});

test('AMBIGUITY stamps every candidate — we do not guess which deal the message was about', async () => {
  const db = fakeDb([
    { id: 'open-a', status: 'open', tourDate: null, dealStageId: null, organizationId: null },
    { id: 'open-b', status: 'open', tourDate: null, dealStageId: null, organizationId: null },
  ]);
  const n = await touchDealsForWhatsAppChat({ contactId: 'c1' }, new Date(), db);
  assert.equal(n, 2);
  assert.deepEqual(db.touched.sort(), ['open-a', 'open-b']);
});

test('an unmatched chat touches nothing', async () => {
  const db = fakeDb([{ id: 'open-a', status: 'open', tourDate: null, dealStageId: null, organizationId: null }]);
  assert.equal(await touchDealsForWhatsAppChat({ contactId: null }, new Date(), db), 0);
  assert.deepEqual(db.touched, []);
});

test('an EXPLICIT email thread link wins outright — no candidate scan', async () => {
  const db = fakeDb([
    { id: 'open-a', status: 'open', tourDate: null, dealStageId: null, organizationId: null },
    { id: 'open-b', status: 'open', tourDate: null, dealStageId: null, organizationId: null },
  ]);
  const n = await touchDealsForEmailThread({ linkedDealId: 'chosen', contactId: 'c1' }, new Date(), db);
  assert.equal(n, 1);
  assert.deepEqual(db.touched, ['chosen'], 'the linked deal only');
});

test('a contact-only email thread falls back to the candidate rule', async () => {
  const db = fakeDb([{ id: 'open-a', status: 'open', tourDate: null, dealStageId: null, organizationId: null }]);
  assert.equal(await touchDealsForEmailThread({ linkedDealId: null, contactId: 'c1' }, new Date(), db), 1);
  assert.deepEqual(db.touched, ['open-a']);
});

test('a thread with neither a deal nor a contact is a no-op', async () => {
  const db = fakeDb([]);
  assert.equal(await touchDealsForEmailThread({ linkedDealId: null, contactId: null }, new Date(), db), 0);
  assert.deepEqual(db.touched, []);
});

test('a contact with no deals at all touches nothing', async () => {
  const db = fakeDb([]);
  assert.deepEqual(await activityDealIdsForContact('c1', db), []);
});
