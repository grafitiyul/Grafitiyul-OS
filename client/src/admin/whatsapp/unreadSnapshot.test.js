import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyUnreadSnapshot,
  isUnreadChat,
  reconcileUnreadSnapshot,
  unreadSessionKey,
} from './unreadSnapshot.js';

// The behavior an operator actually depends on: the "לא נקראו" list holds
// still while they work through it, without ever lying about read state.

const chat = (id, unreadCount = 0, manualUnread = false) => ({ id, unreadCount, manualUnread });
const KEY = unreadSessionKey({ scope: 'active', kind: 'private', accountFilter: 'all', search: '' });

const fold = (prev, chats, sessionKey = KEY) =>
  reconcileUnreadSnapshot(prev, { chats, active: true, sessionKey });

test('opening a chat marks it read but does NOT remove it from the filtered list', () => {
  const chats = [chat('a', 2), chat('b', 1), chat('c', 0)];
  const snap = fold(null, chats);
  assert.deepEqual(applyUnreadSnapshot(chats, snap).map((c) => c.id), ['a', 'b']);

  // The operator opens 'a' — the server clears its unread truth.
  const afterRead = [chat('a', 0), chat('b', 1), chat('c', 0)];
  const snap2 = fold(snap, afterRead);
  assert.deepEqual(applyUnreadSnapshot(afterRead, snap2).map((c) => c.id), ['a', 'b']);
});

test('read state itself stays truthful — only membership is frozen', () => {
  const chats = [chat('a', 2)];
  const snap = fold(null, chats);
  const afterRead = [chat('a', 0)];
  const [row] = applyUnreadSnapshot(afterRead, fold(snap, afterRead));
  assert.equal(row.unreadCount, 0, 'the row is present');
  assert.equal(isUnreadChat(row), false, 'and it is honestly reported as read');
});

test('the row keeps its position — the set is a filter, never a reorder', () => {
  const chats = [chat('a', 1), chat('b', 1), chat('c', 1)];
  const snap = fold(null, chats);
  const afterRead = [chat('a', 1), chat('b', 0), chat('c', 1)];
  assert.deepEqual(applyUnreadSnapshot(afterRead, fold(snap, afterRead)).map((c) => c.id), ['a', 'b', 'c']);
});

test('re-applying the filter recomputes — read conversations drop out', () => {
  const snap = fold(null, [chat('a', 2), chat('b', 1)]);
  const afterRead = [chat('a', 0), chat('b', 1)];
  const held = fold(snap, afterRead);
  // The operator re-clicks the active chip → a new session key.
  const nextKey = unreadSessionKey({ scope: 'active', kind: 'private', accountFilter: 'all', search: '', epoch: 1 });
  const recomputed = fold(held, afterRead, nextKey);
  assert.deepEqual(applyUnreadSnapshot(afterRead, recomputed).map((c) => c.id), ['b']);
});

test('turning the filter off drops the session; turning it back on refreezes', () => {
  const chats = [chat('a', 0), chat('b', 1)];
  const snap = fold(null, [chat('a', 1), chat('b', 1)]);
  const off = reconcileUnreadSnapshot(snap, { chats, active: false, sessionKey: KEY });
  assert.equal(off, null);
  const back = reconcileUnreadSnapshot(off, { chats, active: true, sessionKey: KEY });
  assert.deepEqual(applyUnreadSnapshot(chats, back).map((c) => c.id), ['b']);
});

test('newly unread conversations still appear during a frozen session', () => {
  const snap = fold(null, [chat('a', 1)]);
  const arrived = [chat('a', 0), chat('new', 3)];
  assert.deepEqual(applyUnreadSnapshot(arrived, fold(snap, arrived)).map((c) => c.id), ['a', 'new']);
});

test('changing scope / number / search recomputes the set', () => {
  const chats = [chat('a', 0), chat('b', 1)];
  const snap = fold(null, [chat('a', 1), chat('b', 1)]);
  for (const changed of [
    unreadSessionKey({ scope: 'all', kind: 'private', accountFilter: 'all', search: '' }),
    unreadSessionKey({ scope: 'active', kind: 'group', accountFilter: 'all', search: '' }),
    unreadSessionKey({ scope: 'active', kind: 'private', accountFilter: 'acc_2', search: '' }),
    unreadSessionKey({ scope: 'active', kind: 'private', accountFilter: 'all', search: 'דנה' }),
  ]) {
    assert.deepEqual(applyUnreadSnapshot(chats, fold(snap, chats, changed)).map((c) => c.id), ['b']);
  }
});

test('a manually-unread chat counts as unread, and the fold is identity-stable', () => {
  const chats = [chat('a', 0, true)];
  const snap = fold(null, chats);
  assert.deepEqual(applyUnreadSnapshot(chats, snap).map((c) => c.id), ['a']);
  // No new members → the very same object, so React never re-renders in a loop.
  assert.equal(fold(snap, chats), snap);
});
