import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLabelChange, applyMessageDeleted, recomputeThreadState } from './providerState.js';

// Provider-state math against a fake client — the rules that make the GOS
// inbox match Gmail: inInbox = any live INBOX message; unread counts ONLY
// INBOX∩UNREAD inbound messages (Gmail's badge semantics) minus the GOS
// lastReadAt cutoff; deleted messages leave every computation.

function fakeDb() {
  const threads = new Map();
  const messages = [];
  return {
    threads,
    messages,
    emailThread: {
      findUnique: async ({ where }) => threads.get(where.id) || null,
      update: async ({ where, data }) => {
        const row = threads.get(where.id);
        Object.assign(row, data);
        return row;
      },
    },
    emailMessage: {
      findUnique: async ({ where }) => {
        const k = where.accountId_gmailMessageId;
        return (
          messages.find((m) => m.accountId === k.accountId && m.gmailMessageId === k.gmailMessageId) || null
        );
      },
      findMany: async ({ where }) =>
        messages
          .filter((m) => m.threadId === where.threadId && m.providerDeletedAt == null)
          .sort((a, b) => (b.sentAt?.getTime() || 0) - (a.sentAt?.getTime() || 0)),
      update: async ({ where, data }) => {
        const row = messages.find((m) => m.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
  };
}

const account = { id: 'acc1' };
let seq = 0;
function msg(db, threadId, { labels = [], direction = 'inbound', at, deleted = false } = {}) {
  const row = {
    id: `m${(seq += 1)}`,
    accountId: 'acc1',
    gmailMessageId: `g${seq}`,
    threadId,
    labelIds: labels,
    direction,
    sentAt: new Date(at ?? 1751900000000 + seq * 1000),
    snippet: `snip-${seq}`,
    providerDeletedAt: deleted ? new Date() : null,
  };
  db.messages.push(row);
  return row;
}

function thread(db, { lastReadAt = null } = {}) {
  const row = { id: `t${(seq += 1)}`, lastReadAt, inInbox: true, unreadCount: 99, messageCount: 0 };
  db.threads.set(row.id, row);
  return row;
}

test('unread counts exactly inbox∩unread messages (Gmail badge semantics)', async () => {
  const db = fakeDb();
  const t = thread(db);
  msg(db, t.id, { labels: ['INBOX', 'UNREAD'] }); // counts
  msg(db, t.id, { labels: ['UNREAD'] }); // archived-unread → does NOT count
  msg(db, t.id, { labels: ['INBOX'] }); // read inbox mail → does NOT count
  await recomputeThreadState(t.id, db);
  assert.equal(t.unreadCount, 1);
  assert.equal(t.inInbox, true);
  assert.equal(t.messageCount, 3);
});

// Self-sent mail: Gmail stamps notes-to-self SENT *and* INBOX and shows them as
// unread. Direction must NOT exclude them — normal sent mail never carries
// INBOX, so this is the only case the old direction filter actually affected.
test('self-sent mail (SENT+INBOX+UNREAD) counts as unread, like Gmail', async () => {
  const db = fakeDb();
  const t = thread(db);
  msg(db, t.id, { labels: ['INBOX', 'UNREAD', 'SENT'], direction: 'outbound' });
  await recomputeThreadState(t.id, db);
  assert.equal(t.unreadCount, 1);
});

test('ordinary sent mail (SENT, no INBOX) never counts as unread', async () => {
  const db = fakeDb();
  const t = thread(db);
  msg(db, t.id, { labels: ['SENT'], direction: 'outbound' });
  msg(db, t.id, { labels: ['SENT', 'UNREAD'], direction: 'outbound' }); // still no INBOX
  await recomputeThreadState(t.id, db);
  assert.equal(t.unreadCount, 0);
  assert.equal(t.inInbox, false);
});

test('a thread with no live INBOX message leaves the active inbox', async () => {
  const db = fakeDb();
  const t = thread(db);
  msg(db, t.id, { labels: ['UNREAD'] }); // archived, still unread in Gmail
  msg(db, t.id, { labels: [] });
  await recomputeThreadState(t.id, db);
  assert.equal(t.inInbox, false);
  assert.equal(t.unreadCount, 0); // inbox badge doesn't count archived unread
});

// Gmail's UNREAD label is the single source of truth. The old lastReadAt cutoff
// (from the read-only-scope era) hid messages that were still genuinely unread
// in the mailbox; GOS now writes read-state back to Gmail, so the label clears
// there and disappears here on the next sync.
test('lastReadAt no longer suppresses mail Gmail still labels UNREAD', async () => {
  const db = fakeDb();
  const t = thread(db, { lastReadAt: new Date(1751900005000) });
  msg(db, t.id, { labels: ['INBOX', 'UNREAD'], at: 1751900000000 }); // older than the GOS read marker
  msg(db, t.id, { labels: ['INBOX', 'UNREAD'], at: 1751900010000 });
  await recomputeThreadState(t.id, db);
  assert.equal(t.unreadCount, 2); // both still unread in Gmail → both counted
});

test('a thread read in Gmail (UNREAD label gone) reports zero unread', async () => {
  const db = fakeDb();
  const t = thread(db, { lastReadAt: null });
  msg(db, t.id, { labels: ['INBOX'] });
  msg(db, t.id, { labels: ['INBOX'] });
  await recomputeThreadState(t.id, db);
  assert.equal(t.unreadCount, 0);
});

test('provider-deleted messages leave every computation', async () => {
  const db = fakeDb();
  const t = thread(db);
  msg(db, t.id, { labels: ['INBOX', 'UNREAD'], deleted: true });
  msg(db, t.id, { labels: [] , at: 1751900000000 });
  await recomputeThreadState(t.id, db);
  assert.equal(t.inInbox, false);
  assert.equal(t.unreadCount, 0);
  assert.equal(t.messageCount, 1);
});

test('applyLabelChange add/remove round-trips and reports the thread', async () => {
  const db = fakeDb();
  const t = thread(db);
  const m = msg(db, t.id, { labels: ['INBOX', 'UNREAD'] });
  let threadId = await applyLabelChange(
    account,
    { message: { id: m.gmailMessageId }, labelIds: ['UNREAD'] },
    'remove',
    db,
  );
  assert.equal(threadId, t.id);
  assert.deepEqual(m.labelIds, ['INBOX']);
  threadId = await applyLabelChange(
    account,
    { message: { id: m.gmailMessageId }, labelIds: ['UNREAD'] },
    'add',
    db,
  );
  assert.ok(m.labelIds.includes('UNREAD'));
  // Unknown message (older than the mirror window) → no-op.
  const none = await applyLabelChange(account, { message: { id: 'nope' }, labelIds: ['X'] }, 'add', db);
  assert.equal(none, null);
});

test('applyMessageDeleted stamps once and keeps the row', async () => {
  const db = fakeDb();
  const t = thread(db);
  const m = msg(db, t.id, { labels: ['INBOX'] });
  const threadId = await applyMessageDeleted(account, m.gmailMessageId, db);
  assert.equal(threadId, t.id);
  assert.ok(m.providerDeletedAt instanceof Date);
  const stamp = m.providerDeletedAt;
  await applyMessageDeleted(account, m.gmailMessageId, db); // idempotent
  assert.equal(m.providerDeletedAt, stamp);
  assert.equal(db.messages.length, 1); // never deleted from the mirror
});
