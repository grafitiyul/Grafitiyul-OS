// The Context Pack must never carry Deal.title, and must never carry a secret.
//
// dealTitleGuard.test.js scans SOURCE for `deal.title`. That is the weak half of
// the guarantee here, because the runner legitimately reads the title (to feed
// the runtime guard that detects a leak) and a projection could reintroduce it
// under a different spelling. This test asserts on the BUILT PACK — what is
// actually handed to the model — which is the thing that matters.
//
// It also asserts the privacy boundary: the pack is what leaves our
// infrastructure, so anything sensitive in it is sent to a third party.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContextPack, knownAmountTexts } from './context/pack.js';

const INTERNAL_TITLE = 'ליד חדש - לילי כהן מהאתר';

// A minimal fake DB: only what buildContextPack touches on the no-contact path,
// which is the branch that needs no CRM at all.
const emptyDb = {
  contact: { findUnique: async () => null },
  task: { findMany: async () => [] },
  deal: { findUnique: async () => null },
};

const chat = {
  id: 'chat_1',
  contactId: null,
  type: 'private',
  savedContactName: 'לילי',
  phoneNumber: '972501112222',
};

const messages = [
  { id: 'm1', direction: 'incoming', messageType: 'text', textContent: 'היי, כמה עולה סדנת גרפיטי?', timestampFromSource: new Date('2026-08-08T09:00:00Z') },
  { id: 'm2', direction: 'outgoing', messageType: 'text', textContent: 'היי! כמה אתם?', timestampFromSource: new Date('2026-08-08T09:05:00Z') },
];

test('an unlinked conversation produces a pack with no business claims', async () => {
  const { pack, sources, dealId } = await buildContextPack({ chat, messages, language: 'he' }, emptyDb);
  assert.equal(dealId, null);
  assert.deepEqual(sources, ['conversation']);
  assert.equal(pack.deal, null);
  assert.equal(pack.pricing, null);
  assert.equal(pack.payment, null);
  // The unknown list is what lets the model escalate instead of inventing.
  for (const k of ['customer_not_linked', 'deal', 'pricing', 'payment', 'tour']) {
    assert.ok(pack.unknown.includes(k), `pack.unknown must declare ${k}`);
  }
});

test('the conversation is projected in order, with sender roles', async () => {
  const { pack } = await buildContextPack({ chat, messages, language: 'he' }, emptyDb);
  assert.equal(pack.conversation.messages.length, 2);
  assert.equal(pack.conversation.messages[0].from, 'customer');
  assert.equal(pack.conversation.messages[1].from, 'us');
});

test('media with no text becomes a labelled placeholder, never a silent drop', async () => {
  const withMedia = [
    { id: 'm1', direction: 'incoming', messageType: 'image', textContent: null, timestampFromSource: new Date() },
  ];
  const { pack } = await buildContextPack({ chat, messages: withMedia, language: 'he' }, emptyDb);
  assert.equal(pack.conversation.messages.length, 1);
  assert.match(pack.conversation.messages[0].text, /תמונה/);
});

test('INVARIANT: the built pack never contains the internal deal title', async () => {
  // The serialized pack is literally what is sent to the provider.
  const { pack } = await buildContextPack({ chat, messages, language: 'he' }, emptyDb);
  const serialized = JSON.stringify(pack);
  assert.equal(serialized.includes(INTERNAL_TITLE), false);
  assert.equal(/"title"/.test(serialized), false, 'no bare `title` key may appear in the context pack');
});

test('INVARIANT: the pack carries no phone, no token and no id-like secret', async () => {
  const { pack } = await buildContextPack({ chat, messages, language: 'he' }, emptyDb);
  const serialized = JSON.stringify(pack);
  // The chat's phone number is in scope of the build but must not be projected.
  assert.equal(serialized.includes('972501112222'), false, 'the customer phone must not be sent to the provider');
  for (const k of ['paymentToken', 'publicToken', 'apiKey', 'secret']) {
    assert.equal(serialized.includes(k), false, `the pack must not carry ${k}`);
  }
});

test('conversation context is bounded, not a full transcript', async () => {
  const many = Array.from({ length: 200 }, (_, i) => ({
    id: `m${i}`,
    direction: i % 2 ? 'outgoing' : 'incoming',
    messageType: 'text',
    textContent: 'א'.repeat(500),
    timestampFromSource: new Date(Date.now() - (200 - i) * 60_000),
  }));
  const { pack } = await buildContextPack({ chat, messages: many, language: 'he' }, emptyDb);
  const total = pack.conversation.messages.reduce((n, m) => n + m.text.length, 0);
  assert.ok(total <= 6200, `conversation context must stay bounded, got ${total} chars`);
  assert.ok(pack.conversation.messages.length < 200, 'not every message may be included');
});

test('knownAmountTexts returns only amounts we can actually prove', () => {
  assert.deepEqual(knownAmountTexts({}), []);
  assert.deepEqual(
    knownAmountTexts({ pricing: { totalText: '₪1,200' }, payment: { paidText: '₪400', balanceText: '₪800' } }),
    ['₪1,200', '₪400', '₪800'],
  );
});
