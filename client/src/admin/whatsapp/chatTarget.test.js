import test from 'node:test';
import assert from 'node:assert/strict';
import { draftTarget, isDraftChat, chatTargetKey, materializeChat } from './chatTarget.js';
import { draftKeyFor } from './drafts.js';

const account = { id: 'office', label: 'שירות לקוחות' };
const contact = { id: 'c1', name: 'דנה כהן' };

test('a draft target is a usable conversation with no row behind it', () => {
  const t = draftTarget({ account, contact });
  assert.equal(isDraftChat(t), true);
  assert.equal(t.id, null);
  assert.equal(t.accountId, 'office');
  assert.equal(t.contactId, 'c1');
  assert.equal(t.type, 'private');
  // The thread renders its header from these, so they must be populated —
  // a missing label is exactly what printed a dangling "מ" with nothing after.
  assert.equal(t.account.label, 'שירות לקוחות');
  assert.equal(t.displayName, 'דנה כהן');
});

test('a draft target needs both axes', () => {
  assert.equal(draftTarget({ account, contact: null }), null);
  assert.equal(draftTarget({ account: null, contact }), null);
});

test('a real chat is never mistaken for a draft', () => {
  assert.equal(isDraftChat({ id: 'chat_1', accountId: 'main' }), false);
  assert.equal(isDraftChat(null), false);
});

test('target keys separate the same contact on different numbers', () => {
  const a = chatTargetKey(draftTarget({ account, contact }));
  const b = chatTargetKey(draftTarget({ account: { id: 'main', label: 'מכירות' }, contact }));
  assert.notEqual(a, b);
  // A real chat keys by its id, so materialising remounts the thread onto it.
  assert.equal(chatTargetKey({ id: 'chat_1' }), 'chat_1');
});

test('draft text is kept per contact AND per number, and survives materialising', () => {
  const draft = draftTarget({ account, contact });
  const other = draftTarget({ account: { id: 'main', label: 'מכירות' }, contact });
  assert.notEqual(draftKeyFor(draft), draftKeyFor(other));
  // A real chat keys by chat id — a different scope, which is why the composer
  // clears the text on send rather than leaving it stranded under the old key.
  assert.equal(draftKeyFor({ accountId: 'office', id: 'chat_1' }), 'office:chat_1');
});

test('materialising an already-real chat is a no-op (never a second row)', async () => {
  const real = { id: 'chat_1', accountId: 'main' };
  assert.equal(await materializeChat(real), real);
});

test('materialising an incomplete target fails loudly instead of guessing', async () => {
  await assert.rejects(
    () => materializeChat({ id: null, accountId: 'office' }),
    (e) => e.payload?.error === 'draft_target_incomplete',
  );
});
