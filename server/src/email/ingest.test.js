import test from 'node:test';
import assert from 'node:assert/strict';
import { ingestGmailMessage } from './ingest.js';

// Idempotency / resumability guarantees of the Gmail ingest, exercised
// against an in-memory fake client (opts.db injection). These are the
// invariants that make interrupting + re-running the backfill safe:
//   • at-most-once message import (fast path AND create-race path)
//   • thread aggregates never double-applied
//   • thread create race adopts the winner
//   • auto-linking honours the manual-'unlinked' sentinel

function applyUpdate(row, data) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && 'increment' in v) row[k] += v.increment;
    else row[k] = v;
  }
}

function fakeDb() {
  let seq = 0;
  const nextId = (p) => `${p}${(seq += 1)}`;
  const store = {
    threads: new Map(), // `${accountId}|${gmailThreadId}` → row
    threadsById: new Map(),
    messages: new Map(), // `${accountId}|${gmailMessageId}` → row
    contactEmails: [], // { value, contactId }
    deals: [], // { contactIds: [], ...deal fields }
  };
  const client = {
    store,
    emailMessage: {
      findUnique: async ({ where }) => {
        const k = where.accountId_gmailMessageId;
        return store.messages.get(`${k.accountId}|${k.gmailMessageId}`) || null;
      },
      create: async ({ data }) => {
        const key = `${data.accountId}|${data.gmailMessageId}`;
        if (store.messages.has(key)) {
          const e = new Error('unique constraint');
          e.code = 'P2002';
          throw e;
        }
        const row = { id: nextId('m'), ...data, attachments: data.attachments?.create || [] };
        store.messages.set(key, row);
        return row;
      },
    },
    emailThread: {
      findUnique: async ({ where }) => {
        if (where.accountId_gmailThreadId) {
          const k = where.accountId_gmailThreadId;
          return store.threads.get(`${k.accountId}|${k.gmailThreadId}`) || null;
        }
        return store.threadsById.get(where.id) || null;
      },
      create: async ({ data }) => {
        const key = `${data.accountId}|${data.gmailThreadId}`;
        if (store.threads.has(key)) {
          const e = new Error('unique constraint');
          e.code = 'P2002';
          throw e;
        }
        const row = {
          id: nextId('t'),
          messageCount: 0,
          unreadCount: 0,
          contactId: null,
          matchSource: null,
          linkedDealId: null,
          linkSource: null,
          lastReadAt: null,
          ...data,
        };
        store.threads.set(key, row);
        store.threadsById.set(row.id, row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = store.threadsById.get(where.id);
        applyUpdate(row, data);
        return row;
      },
    },
    contactEmail: {
      findMany: async ({ where }) => {
        const wants = (where.OR || []).map((c) => c.value.equals.toLowerCase());
        return store.contactEmails
          .filter((r) => wants.includes(r.value.toLowerCase()))
          .map((r) => ({ contactId: r.contactId }));
      },
    },
    deal: {
      findMany: async ({ where }) => {
        const contactId = where.contacts.some.contactId;
        return store.deals.filter((d) => d.contactIds.includes(contactId));
      },
    },
    $transaction: async (fn) => fn(client),
  };
  return client;
}

const account = { id: 'acc1', emailAddress: 'info@biz.co.il' };

function gmailMessage({
  id,
  threadId,
  from = 'dana@x.co.il',
  fromName = 'Dana',
  to = 'info@biz.co.il',
  // Default: a fresh inbound inbox message, exactly as Gmail delivers it.
  labels = ['INBOX', 'UNREAD'],
  internalDate = 1751900000000,
  subject = 'שלום',
} = {}) {
  return {
    id,
    threadId,
    labelIds: labels,
    internalDate: String(internalDate),
    snippet: 'snippet text',
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: `${fromName} <${from}>` },
        { name: 'To', value: to },
        { name: 'Subject', value: subject },
        { name: 'Message-ID', value: `<${id}@mail.gmail.com>` },
      ],
      body: { data: Buffer.from('hi there', 'utf8').toString('base64url') },
    },
  };
}

test('new inbound message creates thread + message and applies aggregates once', async () => {
  const db = fakeDb();
  const out = await ingestGmailMessage(account, gmailMessage({ id: 'g1', threadId: 'th1' }), { db });
  assert.equal(out.created, true);
  const thread = db.store.threadsById.get(out.threadId);
  assert.equal(thread.messageCount, 1);
  assert.equal(thread.unreadCount, 1);
  assert.equal(thread.inInbox, true);
  assert.ok(thread.lastMessageAt instanceof Date);
  assert.equal(db.store.messages.size, 1);
});

test('provider state follows Gmail labels: archived stays out of inbox, read stays not-unread', async () => {
  const db = fakeDb();
  // Archived (no INBOX) + already read (no UNREAD) — e.g. 30-day backfill of
  // an old handled conversation.
  const out = await ingestGmailMessage(
    account,
    gmailMessage({ id: 'g1', threadId: 'th1', labels: [] }),
    { db },
  );
  const thread = db.store.threadsById.get(out.threadId);
  assert.equal(thread.inInbox, false); // NOT in the active inbox
  assert.equal(thread.unreadCount, 0); // NOT counted unread
  // A new INBOX message revives the conversation (Gmail behavior).
  await ingestGmailMessage(
    account,
    gmailMessage({ id: 'g2', threadId: 'th1', labels: ['INBOX', 'UNREAD'], internalDate: 1751900100000 }),
    { db },
  );
  assert.equal(db.store.threadsById.get(out.threadId).inInbox, true);
  assert.equal(db.store.threadsById.get(out.threadId).unreadCount, 1);
});

test('CHAT-labeled artifacts (legacy Hangouts) are never imported', async () => {
  const db = fakeDb();
  const out = await ingestGmailMessage(
    account,
    gmailMessage({ id: 'g-chat', threadId: 'th1', labels: ['CHAT'] }),
    { db },
  );
  assert.equal(out.skipped, true);
  assert.equal(db.store.messages.size, 0);
  assert.equal(db.store.threads.size, 0);
});

test('re-ingesting the same message is a no-op (fast path) — counts untouched', async () => {
  const db = fakeDb();
  const msg = gmailMessage({ id: 'g1', threadId: 'th1' });
  const first = await ingestGmailMessage(account, msg, { db });
  const second = await ingestGmailMessage(account, msg, { db });
  assert.equal(second.created, false);
  assert.equal(second.message.id, first.message.id);
  const thread = db.store.threadsById.get(first.threadId);
  assert.equal(thread.messageCount, 1);
  assert.equal(thread.unreadCount, 1);
  assert.equal(db.store.messages.size, 1);
});

test('create race (fast path missed, unique hit) adopts the winner, no double counters', async () => {
  const db = fakeDb();
  const msg = gmailMessage({ id: 'g1', threadId: 'th1' });
  await ingestGmailMessage(account, msg, { db });

  // Simulate the race: the duplicate ingest's fast-path check runs BEFORE the
  // winner committed (returns null once), then its create hits the constraint.
  const realFindUnique = db.emailMessage.findUnique;
  let missed = false;
  db.emailMessage.findUnique = async (args) => {
    if (!missed) {
      missed = true;
      return null;
    }
    return realFindUnique(args);
  };
  const out = await ingestGmailMessage(account, msg, { db });
  assert.equal(out.created, false);
  assert.ok(out.message);
  const thread = db.store.threadsById.get(out.threadId);
  assert.equal(thread.messageCount, 1); // NOT 2 — the raced transaction rolled back
  assert.equal(db.store.messages.size, 1);
});

test('thread create race adopts the winner thread', async () => {
  const db = fakeDb();
  // Simulate: this ingest sees no thread, but a sibling-message ingest creates
  // it before our create lands.
  const realFindUnique = db.emailThread.findUnique;
  let missed = false;
  db.emailThread.findUnique = async (args) => {
    if (args.where.accountId_gmailThreadId && !missed) {
      missed = true;
      // Winner commits the thread between our read and our create.
      await db.emailThread.create({
        data: { accountId: account.id, gmailThreadId: 'th1', participants: [], subject: 'קיים' },
      });
      return null;
    }
    return realFindUnique(args);
  };
  const out = await ingestGmailMessage(account, gmailMessage({ id: 'g2', threadId: 'th1' }), { db });
  assert.equal(out.created, true);
  assert.equal(db.store.threads.size, 1); // one thread, not two
  const thread = db.store.threadsById.get(out.threadId);
  assert.equal(thread.messageCount, 1);
});

test('outbound message resets unread and stamps lastReadAt', async () => {
  const db = fakeDb();
  await ingestGmailMessage(account, gmailMessage({ id: 'g1', threadId: 'th1' }), { db });
  const out = await ingestGmailMessage(
    account,
    gmailMessage({ id: 'g2', threadId: 'th1', from: account.emailAddress, to: 'dana@x.co.il', labels: ['SENT'], internalDate: 1751900100000 }),
    { db },
  );
  const thread = db.store.threadsById.get(out.threadId);
  assert.equal(thread.unreadCount, 0);
  assert.ok(thread.lastReadAt instanceof Date);
  assert.equal(thread.messageCount, 2);
});

test('exact single contact match auto-links; ambiguity does not', async () => {
  const db = fakeDb();
  db.store.contactEmails.push({ value: 'dana@x.co.il', contactId: 'c1' });
  const out = await ingestGmailMessage(account, gmailMessage({ id: 'g1', threadId: 'th1' }), { db });
  let thread = db.store.threadsById.get(out.threadId);
  assert.equal(thread.contactId, 'c1');
  assert.equal(thread.matchSource, 'email');

  // Second account owner for another address → ambiguous → stays unmatched.
  const db2 = fakeDb();
  db2.store.contactEmails.push({ value: 'dana@x.co.il', contactId: 'c1' }, { value: 'dana@x.co.il', contactId: 'c2' });
  const out2 = await ingestGmailMessage(account, gmailMessage({ id: 'g1', threadId: 'th1' }), { db: db2 });
  thread = db2.store.threadsById.get(out2.threadId);
  assert.equal(thread.contactId, null);
});

test("manual 'unlinked' sentinel blocks auto re-matching and auto deal-linking", async () => {
  const db = fakeDb();
  db.store.contactEmails.push({ value: 'dana@x.co.il', contactId: 'c1' });
  // Thread exists, user manually unlinked it.
  const thread = await db.emailThread.create({
    data: {
      accountId: account.id,
      gmailThreadId: 'th1',
      participants: [{ email: 'dana@x.co.il', name: 'Dana' }],
      matchSource: 'unlinked',
      linkSource: 'unlinked',
    },
  });
  await ingestGmailMessage(account, gmailMessage({ id: 'g9', threadId: 'th1' }), { db });
  const after = db.store.threadsById.get(thread.id);
  assert.equal(after.contactId, null); // NOT re-matched
  assert.equal(after.linkedDealId, null);
});

test('deal auto-link only on exactly one safe candidate', async () => {
  const db = fakeDb();
  db.store.contactEmails.push({ value: 'dana@x.co.il', contactId: 'c1' });
  db.store.deals.push({
    id: 'd1', title: 'סיור', status: 'open', tourDate: null, valueMinor: 0n,
    dealStageId: null, organizationId: null, contactIds: ['c1'],
  });
  const out = await ingestGmailMessage(account, gmailMessage({ id: 'g1', threadId: 'th1' }), { db });
  const thread = db.store.threadsById.get(out.threadId);
  assert.equal(thread.linkedDealId, 'd1');
  assert.equal(thread.linkSource, 'auto');

  // Two open deals → ambiguous → NOT auto-linked.
  const db2 = fakeDb();
  db2.store.contactEmails.push({ value: 'dana@x.co.il', contactId: 'c1' });
  db2.store.deals.push(
    { id: 'd1', title: 'א', status: 'open', tourDate: null, valueMinor: 0n, dealStageId: null, organizationId: null, contactIds: ['c1'] },
    { id: 'd2', title: 'ב', status: 'open', tourDate: null, valueMinor: 0n, dealStageId: null, organizationId: null, contactIds: ['c1'] },
  );
  const out2 = await ingestGmailMessage(account, gmailMessage({ id: 'g1', threadId: 'th1' }), { db: db2 });
  assert.equal(db2.store.threadsById.get(out2.threadId).linkedDealId, null);
});

test('drafts / spam / trash are skipped entirely', async () => {
  const db = fakeDb();
  for (const label of ['DRAFT', 'SPAM', 'TRASH']) {
    const out = await ingestGmailMessage(account, gmailMessage({ id: `g-${label}`, threadId: 'th1', labels: [label] }), { db });
    assert.equal(out.skipped, true);
  }
  assert.equal(db.store.messages.size, 0);
  assert.equal(db.store.threads.size, 0);
});
